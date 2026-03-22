import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from nacl import utils

from app.core.config import Settings


def room_identifier(room_code: str, settings: Settings) -> str:
    digest = hmac.new(
        settings.app_secret.encode("utf-8"),
        room_code.strip().upper().encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"room_{digest[:24]}"


def generate_room_salt() -> str:
    return base64.b64encode(utils.random(16)).decode("ascii")


def generate_random_nickname() -> str:
    suffix = secrets.token_hex(3)
    return f"ghost_{suffix}"


def issue_join_ticket(room_id: str, nickname: str, settings: Settings) -> str:
    payload = {
        "sub": nickname,
        "room_id": room_id,
        "exp": datetime.now(UTC) + timedelta(seconds=settings.join_ticket_ttl_seconds),
        "iat": datetime.now(UTC),
        "jti": secrets.token_urlsafe(12),
    }
    return jwt.encode(payload, settings.app_secret, algorithm="HS256")


def decode_join_ticket(token: str, settings: Settings) -> dict:
    return jwt.decode(token, settings.app_secret, algorithms=["HS256"])
