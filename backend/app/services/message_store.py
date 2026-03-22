from datetime import UTC, datetime, timedelta
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import Settings


class MessageStore:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._client = AsyncIOMotorClient(settings.mongodb_url)
        self._db: AsyncIOMotorDatabase = self._client[settings.mongodb_db]

    async def ensure_indexes(self) -> None:
        await self._db.messages.create_index("expires_at", expireAfterSeconds=0)
        await self._db.messages.create_index([("room_id", 1), ("created_at", -1)])

    async def save_encrypted_message(self, room_id: str, envelope: dict[str, Any]) -> None:
        if not self._settings.enable_message_persistence:
            return
        now = datetime.now(UTC)
        document = {
            "room_id": room_id,
            "created_at": now,
            "expires_at": now + timedelta(seconds=self._settings.message_ttl_seconds),
            "payload": envelope,
        }
        await self._db.messages.insert_one(document)

    async def close(self) -> None:
        self._client.close()
