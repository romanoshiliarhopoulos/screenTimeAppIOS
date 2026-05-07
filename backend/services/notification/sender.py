import logging

import httpx

EXPO_PUSH_URL = "https://exp.host/--/exponent-push-notification/send"
NTFY_BASE_URL = "https://ntfy.sh"

logger = logging.getLogger(__name__)


def send(token: str, title: str, body: str, data: dict | None = None) -> dict:
    """
    Send a push notification. Supports two delivery methods:
      - ntfy:   token starts with "ntfy:" e.g. "ntfy:screentimeapp-romanos-test"
      - Expo:   token is "ExponentPushToken[...]"
    """
    if token.startswith("ntfy:"):
        return _send_ntfy(topic=token[5:], title=title, body=body)
    return _send_expo(token=token, title=title, body=body, data=data)


def send_many(tokens: list[str], title: str, body: str, data: dict | None = None) -> list[dict]:
    return [send(t, title, body, data) for t in tokens]


def _send_expo(token: str, title: str, body: str, data: dict | None) -> dict:
    payload: dict = {"to": token, "title": title, "body": body, "sound": "default"}
    if data:
        payload["data"] = data
    try:
        response = httpx.post(
            EXPO_PUSH_URL,
            json=payload,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json().get("data", {})
    except httpx.HTTPError as exc:
        logger.error("Expo push failed: %s", exc)
        return {"status": "error", "message": str(exc)}


def _send_ntfy(topic: str, title: str, body: str) -> dict:
    try:
        response = httpx.post(
            f"{NTFY_BASE_URL}/{topic}",
            content=body.encode(),
            headers={"Title": title, "Priority": "default"},
            timeout=10.0,
        )
        response.raise_for_status()
        return {"status": "ok"}
    except httpx.HTTPError as exc:
        logger.error("ntfy push failed: %s", exc)
        return {"status": "error", "message": str(exc)}
