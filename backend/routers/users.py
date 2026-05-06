from fastapi import APIRouter, Depends
from auth import get_uid
from firestore_client import db
from models import UserProfile

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me")
async def get_profile(uid: str = Depends(get_uid)):
    doc = (
        db.collection("users").document(uid).collection("profile").document("info").get()
    )
    if not doc.exists:
        return {"userId": uid, "displayName": None, "pushToken": None}
    return {"userId": uid, **doc.to_dict()}


@router.put("/me")
async def update_profile(payload: UserProfile, uid: str = Depends(get_uid)):
    ref = db.collection("users").document(uid).collection("profile").document("info")
    data: dict = {"displayName": payload.display_name}
    if payload.push_token is not None:
        data["pushToken"] = payload.push_token
    ref.set(data, merge=True)
    return {"status": "ok"}
