from datetime import datetime, timezone, timedelta


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def compute_session(
    app_name: str,
    open_time: str,
    close_time: str,
    uid: str,
    device_id: str | None,
    previous_close_time: str | None = None,
) -> dict:
    """
    Build a session document and detect the unlock pattern.

    Unlock pattern: iOS doesn't fire an open event when the user unlocks directly
    back into an already-open app. We detect this when the previous session for
    the same device closed within 5 seconds of the current openTime (i.e., the
    Shortcut's "open" event is suspiciously close to the last close).

    In that case we cap the duration to 20 minutes and flag status="inferred_unlock".
    """
    open_dt = _parse_iso(open_time)
    close_dt = _parse_iso(close_time)

    status = "clean"

    if previous_close_time:
        prev_close_dt = _parse_iso(previous_close_time)
        gap = (open_dt - prev_close_dt).total_seconds()
        # Gap < 5s means the "open" event was right after the last close → unlock
        if abs(gap) < 5:
            inferred_open = max(prev_close_dt, close_dt - timedelta(minutes=20))
            open_dt = inferred_open
            open_time = inferred_open.isoformat()
            status = "inferred_unlock"

    duration = max(0, int((close_dt - open_dt).total_seconds()))

    return {
        "userId": uid,
        "appName": app_name,
        "openTime": open_time,
        "closeTime": close_time,
        "durationSeconds": duration,
        "deviceId": device_id or "",
        "status": status,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
