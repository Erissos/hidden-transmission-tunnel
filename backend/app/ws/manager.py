from collections import defaultdict

from fastapi import WebSocket
from redis.asyncio import Redis


class ConnectionManager:
    def __init__(self, redis: Redis):
        self.redis = redis
        self.connections: dict[str, dict[str, WebSocket]] = defaultdict(dict)

    async def connect(self, room_id: str, nickname: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections[room_id][nickname] = websocket
        await self.redis.sadd(f"presence:{room_id}", nickname)

    async def disconnect(self, room_id: str, nickname: str) -> None:
        room_connections = self.connections.get(room_id)
        if room_connections and nickname in room_connections:
            room_connections.pop(nickname, None)
            if not room_connections:
                self.connections.pop(room_id, None)
        await self.redis.srem(f"presence:{room_id}", nickname)

    async def broadcast(self, room_id: str, message: dict) -> None:
        for websocket in list(self.connections.get(room_id, {}).values()):
            await websocket.send_json(message)

    async def list_presence(self, room_id: str) -> list[str]:
        members = await self.redis.smembers(f"presence:{room_id}")
        return sorted(members)
