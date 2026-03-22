import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.container import AppState
from app.core.security import decode_join_ticket, issue_join_ticket
from app.dependencies import require_admin, resolve_client_ip
from app.schemas.admin import AdminSessionResponse
from app.schemas.rooms import CreateRoomRequest, CreateRoomResponse, JoinRoomRequest, JoinRoomResponse
from app.schemas.ws import CipherMessagePayload, ClientHelloPayload, ServerEvent
from app.services.event_bus import RedisEventBus
from app.services.message_store import MessageStore
from app.services.rate_limiter import RedisRateLimiter
from app.services.redis_client import build_redis
from app.services.room_service import RoomService
from app.ws.manager import ConnectionManager


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    redis = build_redis(settings)
    message_store = MessageStore(settings)
    event_bus = RedisEventBus(redis)
    stop_event = asyncio.Event()
    await message_store.ensure_indexes()

    app.state.container = AppState(
        settings=settings,
        redis=redis,
        rooms=RoomService(redis, settings),
        limiter=RedisRateLimiter(redis),
        manager=ConnectionManager(redis),
        message_store=message_store,
        event_bus=event_bus,
    )
    listener = asyncio.create_task(event_bus.run(app.state.container.manager.broadcast, stop_event))
    yield
    stop_event.set()
    listener.cancel()
    try:
        await listener
    except asyncio.CancelledError:
        pass
    await redis.aclose()
    await message_store.close()


app = FastAPI(title="Hidden Transmission Tunnel", lifespan=lifespan)
settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "hidden-transmission-tunnel"}


@app.get("/api/v1/admin/session", response_model=AdminSessionResponse, dependencies=[Depends(require_admin)])
async def admin_session(request: Request) -> AdminSessionResponse:
    client_ip = resolve_client_ip(request, app.state.container.settings)
    return AdminSessionResponse(ok=True, client_ip=client_ip)


@app.post("/api/v1/admin/rooms", response_model=CreateRoomResponse, dependencies=[Depends(require_admin)])
async def create_room(payload: CreateRoomRequest) -> CreateRoomResponse:
    container: AppState = app.state.container
    room = await container.rooms.create_room(
        room_code=payload.room_code,
        ttl_seconds=payload.ttl_seconds,
        persist_messages=payload.persist_messages,
    )
    return CreateRoomResponse(
        room_id=room["room_id"],
        room_salt=room["room_salt"],
        expires_at=room["expires_at"],
    )

@app.post("/api/v1/rooms/join", response_model=JoinRoomResponse)
async def join_room(payload: JoinRoomRequest, request: Request) -> JoinRoomResponse:
    container: AppState = app.state.container
    client_ip = resolve_client_ip(request, container.settings)
    attempt_key = f"bruteforce:join:{client_ip}"

    room = await container.rooms.get_room(payload.room_code)
    if room:
        await container.limiter.reset_failed_join_attempts(attempt_key)
    else:
        allowed, retry_after = await container.limiter.record_failed_join_attempt(
            key=attempt_key,
            limit=container.settings.brute_force_limit,
            replenish_seconds=container.settings.brute_force_replenish_seconds,
            lock_seconds=container.settings.brute_force_lock_seconds,
        )
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many attempts. Try again in {retry_after} seconds.",
                headers={"Retry-After": str(retry_after)},
            )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    room = await container.rooms.join_room(payload.room_code)
    ticket = issue_join_ticket(room["room_id"], room["nickname"], container.settings)
    return JoinRoomResponse(
        room_id=room["room_id"],
        nickname=room["nickname"],
        room_salt=room["room_salt"],
        ws_ticket=ticket,
        persistence_enabled=room["persistence_enabled"],
    )


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    container: AppState = app.state.container
    ticket = websocket.query_params.get("ticket")
    if not ticket:
        await websocket.close(code=4401, reason="Missing ticket")
        return

    try:
        claims = decode_join_ticket(ticket, container.settings)
    except Exception:
        await websocket.close(code=4401, reason="Invalid ticket")
        return

    room_id = claims["room_id"]
    nickname = claims["sub"]
    await container.manager.connect(room_id, nickname, websocket)
    await container.event_bus.publish(
        room_id,
        ServerEvent(
            type="presence",
            payload={
                "members": await container.manager.list_presence(room_id),
                "joined": nickname,
            },
        ).model_dump(),
    )

    try:
        while True:
            raw = await websocket.receive_json()
            message_type = raw.get("type")
            if message_type == "hello":
                hello = ClientHelloPayload.model_validate(raw)
                await container.event_bus.publish(
                    room_id,
                    ServerEvent(
                        type="participant-key",
                        payload={
                            "nickname": nickname,
                            "public_key": hello.public_key,
                        },
                    ).model_dump(),
                )
                continue

            if message_type != "ciphertext":
                await websocket.send_json(ServerEvent(type="error", payload={"detail": "Unsupported message type"}).model_dump())
                continue

            allowed = await container.limiter.allow(
                key=f"rate:{room_id}:{nickname}",
                limit=container.settings.rate_limit_messages,
                window_seconds=container.settings.rate_limit_window_seconds,
            )
            if not allowed:
                await websocket.send_json(
                    ServerEvent(type="rate-limited", payload={"detail": "Too many messages"}).model_dump()
                )
                continue

            payload = CipherMessagePayload.model_validate(raw)
            envelope = {
                "nickname": nickname,
                "nonce": payload.nonce,
                "ciphertext": payload.ciphertext,
                "signature": payload.signature,
                "public_key": payload.public_key,
                "timestamp": payload.timestamp,
                "self_destruct_seconds": payload.self_destruct_seconds,
            }
            await container.message_store.save_encrypted_message(room_id, envelope)
            await container.event_bus.publish(
                room_id,
                ServerEvent(type="ciphertext", payload=envelope).model_dump(),
            )
    except WebSocketDisconnect:
        await container.manager.disconnect(room_id, nickname)
        await container.event_bus.publish(
            room_id,
            ServerEvent(
                type="presence",
                payload={
                    "members": await container.manager.list_presence(room_id),
                    "left": nickname,
                },
            ).model_dump(),
        )