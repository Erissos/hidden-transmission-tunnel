from ipaddress import ip_address, ip_network
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from redis.asyncio import Redis

from app.core.config import Settings, get_settings
from app.core.container import AppState


def get_app_state() -> AppState:
    from app.main import app

    return app.state.container


def get_settings_dep() -> Settings:
    return get_settings()


def get_redis(container: Annotated[AppState, Depends(get_app_state)]) -> Redis:
    return container.redis


def resolve_client_ip(request: Request, settings: Settings) -> str:
    if settings.trust_proxy_headers:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        if forwarded_for:
            return forwarded_for.split(",", maxsplit=1)[0].strip()

    if request.client is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Client IP unavailable")
    return request.client.host


def is_ip_allowed(client_ip: str, allowed_ips: list[str]) -> bool:
    address = ip_address(client_ip)
    for candidate in allowed_ips:
        network = ip_network(candidate, strict=False)
        if address in network:
            return True
    return False


async def require_admin(
    request: Request,
    x_admin_key: Annotated[str | None, Header()] = None,
    settings: Annotated[Settings, Depends(get_settings_dep)] = None,
) -> None:
    client_ip = resolve_client_ip(request, settings)
    if not is_ip_allowed(client_ip, settings.admin_allowed_ips):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="IP address not allowed")
    if x_admin_key != settings.admin_api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

