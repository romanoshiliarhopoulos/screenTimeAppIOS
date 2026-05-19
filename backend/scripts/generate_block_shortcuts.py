"""
Run this script locally on a Mac whenever the shortcut structure changes.
Generates signed .shortcut files for every app — three per app:

  {app}-launcher.shortcut      Home-screen icon replacement (gateway check)
  {app}-open.shortcut          iOS automation: fires when app opens
  {app}-close.shortcut         iOS automation: fires when app closes

Output: backend/shortcuts/new_shortcuts/

Usage:
    cd backend
    python scripts/generate_block_shortcuts.py

Environment variables:
    API_URL  — defaults to https://functions-eight-topaz.vercel.app
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.block_shortcut_service import build_block_shortcut_plist, sign_block_shortcut

APPS = [
    "Instagram",
    "YouTube",
    "Facebook",
    "TikTok",
    "X",
    "Snapchat",
    "Reddit",
    "Threads",
    "WhatsApp",
    "Discord",
    "Twitch",
    "LinkedIn",
]

EVENTS = ["launcher", "open", "close"]

OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "shortcuts",
    "new_shortcuts",
)


def main():
    api_url = os.environ.get("API_URL", "https://functions-eight-topaz.vercel.app")

    os.makedirs(OUT_DIR, exist_ok=True)
    total = len(APPS) * len(EVENTS)
    done = 0

    for app in APPS:
        for event in EVENTS:
            plist_bytes = build_block_shortcut_plist(app, event, api_url)
            signed_bytes = sign_block_shortcut(plist_bytes)

            filename = f"{app}-{event}.shortcut"
            out_path = os.path.join(OUT_DIR, filename)
            with open(out_path, "wb") as f:
                f.write(signed_bytes)

            done += 1
            print(f"[{done}/{total}] {filename} ({len(signed_bytes):,} bytes)")

    print(f"\nDone — {total} shortcuts written to {OUT_DIR}")


if __name__ == "__main__":
    main()
