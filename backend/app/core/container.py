from dataclasses import dataclass

from app.core.config import Settings
from app.services.event_bus import RedisEventBus
from app.services.message_store import MessageStore
from app.services.rate_limiter import RedisRateLimiter
from app.services.room_service import RoomService
from app.ws.manager import ConnectionManager


@dataclass
class AppState:
    settings: Settings
    redis: object
    rooms: RoomService
    limiter: RedisRateLimiter
    manager: ConnectionManager
    message_store: MessageStore
    event_bus: RedisEventBus
