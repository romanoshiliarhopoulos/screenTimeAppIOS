import sys
import os

# Add the backend root to sys.path so that routers, services, etc. are importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app  # noqa: F401 — Vercel picks up the `app` ASGI object
