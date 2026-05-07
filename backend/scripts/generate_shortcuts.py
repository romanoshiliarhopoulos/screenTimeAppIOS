"""
Run this script locally on a Mac whenever the shortcut structure changes.
It pre-generates signed .shortcut files for every app+event combination
and saves them to backend/shortcuts/signed/.

Usage:
    cd backend
    python scripts/generate_shortcuts.py
"""

import os
import sys

# Allow importing from backend root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.shortcut_generator_service import build_shortcut_plist, sign_shortcut

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

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "shortcuts", "signed")


def main():
    api_url = os.environ.get("API_URL", "https://functions-eight-topaz.vercel.app")
    api_key = os.environ.get("SHORTCUT_API_KEY", "")

    os.makedirs(OUT_DIR, exist_ok=True)
    total = len(APPS) * 2
    done = 0

    for app in APPS:
        for event in ("open", "close"):
            plist_bytes = build_shortcut_plist(app, event, api_url, api_key)
            signed_bytes = sign_shortcut(plist_bytes)

            filename = f"{app}-{event}.shortcut"
            out_path = os.path.join(OUT_DIR, filename)
            with open(out_path, "wb") as f:
                f.write(signed_bytes)

            done += 1
            print(f"[{done}/{total}] {filename} ({len(signed_bytes):,} bytes)")

    print(f"\nDone — {total} shortcuts written to {OUT_DIR}")


if __name__ == "__main__":
    main()
