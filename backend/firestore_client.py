import os
import json
import firebase_admin
from firebase_admin import credentials, firestore

if not firebase_admin._apps:
    service_account = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT"])
    cred = credentials.Certificate(service_account)
    firebase_admin.initialize_app(cred, {
        "storageBucket": os.environ.get("FIREBASE_STORAGE_BUCKET", ""),
    })

db = firestore.client()
