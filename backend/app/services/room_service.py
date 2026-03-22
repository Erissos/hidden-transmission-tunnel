from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from redis.asyncio import Redis

from app.core.config import Settings
from app.core.security import generate_random_nickname, generate_room_salt, room_identifier


class RoomService:
    def __init__(self, redis: Redis, settings: Settings):
        self.redis = redis
        self.settings = settings

    async def create_room(self, room_code: str, ttl_seconds: int, persist_messages: bool) -> dict:
        room_id = room_identifier(room_code, self.settings)
        room_key = f"room:{room_id}"
        exists = await self.redis.exists(room_key)
        if exists:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Room already exists")

        now = datetime.now(UTC)
        expires_at = now + timedelta(seconds=ttl_seconds)
        room_data = {
            "room_id": room_id,
            "room_salt": generate_room_salt(),
            "created_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "persist_messages": "true" if persist_messages else "false",
        }

        await self.redis.hset(room_key, mapping=room_data)
        await self.redis.expire(room_key, ttl_seconds)
        return room_data

    async def get_room(self, room_code: str) -> dict | None:
        room_id = room_identifier(room_code, self.settings)
        room_key = f"room:{room_id}"
        room_data = await self.redis.hgetall(room_key)
        if not room_data:
            return None
        return {
            "room_id": room_id,
            "room_salt": room_data["room_salt"],
            "persistence_enabled": room_data["persist_messages"] == "true",
        }

    async def join_room(self, room_code: str) -> dict:
        room = await self.get_room(room_code)
        if not room:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

        return {
            "room_id": room["room_id"],
            "nickname": generate_random_nickname(),
            "room_salt": room["room_salt"],
            "persistence_enabled": room["persistence_enabled"],
        }
