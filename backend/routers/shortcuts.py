import os

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

router = APIRouter(prefix="/api/shortcuts", tags=["shortcuts"])

SIGNED_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "shortcuts", "signed")

SUPPORTED_APPS = [
    {"id": "instagram", "name": "Instagram"},
    {"id": "youtube",   "name": "YouTube"},
    {"id": "facebook",  "name": "Facebook"},
    {"id": "tiktok",    "name": "TikTok"},
    {"id": "x",         "name": "X"},
    {"id": "snapchat",  "name": "Snapchat"},
    {"id": "reddit",    "name": "Reddit"},
    {"id": "threads",   "name": "Threads"},
    {"id": "whatsapp",  "name": "WhatsApp"},
    {"id": "discord",   "name": "Discord"},
    {"id": "twitch",    "name": "Twitch"},
    {"id": "linkedin",  "name": "LinkedIn"},
]


@router.get("/apps")
def list_apps():
    return SUPPORTED_APPS


@router.get("/download")
def download_shortcut(
    appName: str = Query(..., description="App to track, e.g. Instagram"),
    event: str = Query(..., pattern="^(open|close)$", description="open or close"),
):
    """
    Serves a pre-signed .shortcut file for the given app and event.
    No auth required — userId is entered once by the user at install time
    via the Import Question dialog.
    Open this URL in Safari; iOS hands the file off to the Shortcuts app.
    """
    path = os.path.join(SIGNED_DIR, f"{appName}-{event}.shortcut")
    if not os.path.isfile(path):
        raise HTTPException(
            status_code=404,
            detail=f"No shortcut found for {appName} ({event})",
        )

    with open(path, "rb") as f:
        file_bytes = f.read()

    filename = f"Track {appName} {event.capitalize()}.shortcut"
    return Response(
        content=file_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
