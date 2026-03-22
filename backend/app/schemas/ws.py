from typing import Literal

from pydantic import BaseModel, Field


class ClientHelloPayload(BaseModel):
    type: Literal["hello"] = "hello"
    public_key: str = Field(min_length=32)


class CipherMessagePayload(BaseModel):
    type: Literal["ciphertext"] = "ciphertext"
    nonce: str
    ciphertext: str
    signature: str
    public_key: str
    timestamp: str = Field(min_length=20, max_length=64)
    self_destruct_seconds: int | None = Field(default=None, ge=1, le=3600)


class ServerEvent(BaseModel):
    type: str
    payload: dict
