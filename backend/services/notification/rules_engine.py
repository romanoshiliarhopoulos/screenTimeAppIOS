from datetime import datetime, timezone
from typing import Optional

from .models import NotificationSettings


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def elapsed_seconds(open_time_iso: str) -> int:
    return int((_now() - _parse_iso(open_time_iso)).total_seconds())


def is_in_quiet_hours(settings: NotificationSettings) -> bool:
    if not settings.quietHoursStart or not settings.quietHoursEnd:
        return False
    now = _now()
    start_h, start_m = map(int, settings.quietHoursStart.split(":"))
    end_h, end_m = map(int, settings.quietHoursEnd.split(":"))
    current = now.hour * 60 + now.minute
    start = start_h * 60 + start_m
    end = end_h * 60 + end_m
    if start <= end:
        return start <= current < end
    # Crosses midnight (e.g. 22:30 → 07:00)
    return current >= start or current < end


def passes_user_threshold(open_time_iso: str, settings: NotificationSettings) -> bool:
    return elapsed_seconds(open_time_iso) >= settings.userAlertThresholdSeconds


def passes_friend_threshold(open_time_iso: str, settings: NotificationSettings) -> bool:
    return elapsed_seconds(open_time_iso) >= settings.friendAlertThresholdSeconds
