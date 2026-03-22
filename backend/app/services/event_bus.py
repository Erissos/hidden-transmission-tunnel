import asyncio
import json
from collections.abc import Awaitable, Callable

from redis.asyncio import Redis


class RedisEventBus:
    def __init__(self, redis: Redis):
        self.redis = redis

    async def publish(self, room_id: str, event: dict) -> None:
        await self.redis.publish(f"room-events:{room_id}", json.dumps(event))

    async def run(
        self,
        callback: Callable[[str, dict], Awaitable[None]],
        stop_event: asyncio.Event,
    ) -> None:
        pubsub = self.redis.pubsub()
        await pubsub.psubscribe("room-events:*")
        try:
            while not stop_event.is_set():
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if not message:
                    continue
                channel = message["channel"]
                if isinstance(channel, bytes):
                    channel = channel.decode("utf-8")
                room_id = channel.split(":", maxsplit=1)[1]
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                await callback(room_id, json.loads(data))
        finally:
            await pubsub.close()
