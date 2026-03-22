from pydantic import BaseModel


class AdminSessionResponse(BaseModel):
    ok: bool
    client_ip: str
