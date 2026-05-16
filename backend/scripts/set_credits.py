"""
One-off script: set blockCredits = 100 for every user document.
Run from the backend/ directory with FIREBASE_SERVICE_ACCOUNT set:
  cd backend && python scripts/set_credits.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from firestore_client import db

users = list(db.collection("users").stream())
print(f"Found {len(users)} users. Setting blockCredits = 100 for each...")

for doc in users:
    doc.reference.set({"blockCredits": 100}, merge=True)
    print(f"  ✓ {doc.id}")

print("Done.")
