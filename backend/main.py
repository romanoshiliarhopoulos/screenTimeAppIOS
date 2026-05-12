from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import firestore_client  # noqa: F401 — ensures Firebase is initialised before routers load

from routers import usage, groups, users, shortcuts, notifications, social

app = FastAPI(
    title="ScreenTime API",
    description="Backend for the Stop Doomscrolling iOS app",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(usage.router)
app.include_router(groups.router)
app.include_router(users.router)
app.include_router(shortcuts.router)
app.include_router(notifications.router)
app.include_router(social.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
