from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", BACKEND_ROOT / ".env"),
        env_prefix="HTT_",
        extra="ignore",
    )

    app_name: str = "Hidden Transmission Tunnel"
    env: str = "development"
    admin_api_key: str = "change-me"
    admin_allowed_ips: list[str] = Field(default_factory=lambda: ["127.0.0.1", "::1"])
    trust_proxy_headers: bool = False
    app_secret: str = "change-me-too"
    allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    redis_url: str = "redis://localhost:6379/0"
    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_db: str = "hidden_transmission_tunnel"
    enable_message_persistence: bool = False
    message_ttl_seconds: int = 86400
    join_ticket_ttl_seconds: int = 90
    rate_limit_messages: int = 12
    rate_limit_window_seconds: int = 10
    brute_force_limit: int = 8
    brute_force_window_seconds: int = 300
    brute_force_replenish_seconds: int = 5
    brute_force_lock_seconds: int = 1800

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_allowed_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, list):
            return value
        if not value:
            return ["http://localhost:3000"]
        if value.startswith("["):
            import json

            parsed = json.loads(value)
            return [str(item) for item in parsed]
        return [item.strip() for item in value.split(",") if item.strip()]

    @field_validator("admin_allowed_ips", mode="before")
    @classmethod
    def parse_admin_allowed_ips(cls, value: str | list[str]) -> list[str]:
        return cls.parse_allowed_origins(value)


@lru_cache
def get_settings() -> Settings:
    return Settings()

