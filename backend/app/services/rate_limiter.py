import time

from redis.asyncio import Redis


class RedisRateLimiter:
    def __init__(self, redis: Redis):
        self.redis = redis

    async def allow(self, key: str, limit: int, window_seconds: int) -> bool:
        count = await self.redis.incr(key)
        if count == 1:
            await self.redis.expire(key, window_seconds)
        return count <= limit

    async def record_failed_join_attempt(
        self,
        key: str,
        limit: int,
        replenish_seconds: int,
        lock_seconds: int,
    ) -> tuple[bool, int]:
        lock_key = f"{key}:lock"
        state_key = f"{key}:state"

        if await self.redis.exists(lock_key):
            ttl = await self.redis.ttl(lock_key)
            return False, max(ttl, 0)

        now = int(time.time())
        state = await self.redis.hgetall(state_key)
        attempts = int(state.get("attempts", "0"))
        last_attempt = int(state.get("last_attempt", str(now)))

        replenished = max(0, (now - last_attempt) // replenish_seconds)
        attempts = max(0, attempts - replenished)
        attempts += 1

        await self.redis.hset(
            state_key,
            mapping={
                "attempts": attempts,
                "last_attempt": now,
            },
        )
        await self.redis.expire(state_key, max(limit * replenish_seconds, lock_seconds))

        if attempts >= limit:
            await self.redis.set(lock_key, "1", ex=lock_seconds)
            await self.redis.delete(state_key)
            return False, lock_seconds

        return True, 0

    async def reset_failed_join_attempts(self, key: str) -> None:
        await self.redis.delete(f"{key}:lock", f"{key}:state")
