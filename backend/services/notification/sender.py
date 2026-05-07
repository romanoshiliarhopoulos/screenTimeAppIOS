import logging

import httpx

EXPO_PUSH_URL = "https://exp.host/--/exponent-push-notification/send"

logger = logging.getLogger(__name__)


def send(token: str, title: str, body: str, data: dict | None = None) -> dict:
    """
    Send a single push notification via Expo's push API.
    Returns the Expo ticket dict: {"status": "ok"} or {"status": "error", ...}.
    """
    payload: dict = {"to": token, "title": title, "body": body, "sound": "default"}
    if data:
        payload["data"] = data

    try:
        response = httpx.post(
            EXPO_PUSH_URL,
            json=payload,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            timeout=10.0,
        )
        response.raise_for_status()
        ticket = response.json().get("data", {})
        return ticket
    except httpx.HTTPError as exc:
        logger.error("Expo push failed: %s", exc)
        return {"status": "error", "message": str(exc)}


def send_many(tokens: list[str], title: str, body: str, data: dict | None = None) -> list[dict]:
    return [send(t, title, body, data) for t in tokens]
