from pydantic import BaseModel
from typing import Optional


class UsagePayload(BaseModel):
    app_name: str
    open_time: str   # ISO 8601, e.g. "2026-05-05T14:00:00Z"
    close_time: str  # ISO 8601
    device_id: Optional[str] = None


class UserProfile(BaseModel):
    display_name: str
    push_token: Optional[str] = None


class CreateGroupPayload(BaseModel):
    name: str
