from datetime import datetime

from pydantic import BaseModel, Field


class CreateRoomRequest(BaseModel):
    room_code: str = Field(min_length=6, max_length=32)
    ttl_seconds: int = Field(default=86400, ge=300, le=604800)
    persist_messages: bool = False


class CreateRoomResponse(BaseModel):
    room_id: str
    room_salt: str
    expires_at: datetime


class JoinRoomRequest(BaseModel):
    room_code: str = Field(min_length=6, max_length=32)


class JoinRoomResponse(BaseModel):
    room_id: str
    nickname: str
    room_salt: str
    ws_ticket: str
    persistence_enabled: bool
