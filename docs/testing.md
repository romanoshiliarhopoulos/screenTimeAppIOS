# Testing Guide

Quick testing patterns for backend API and basic frontend validation.

## Backend API Testing (Primary Focus)

Test that your Vercel Functions correctly receive and store Shortcuts data.

### Using curl

```bash
# Test recording an app opening
curl -X POST http://localhost:3000/api/recordUsage \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "appName": "Instagram",
    "openTime": 1715000000
  }'

# Test recording an app closing
curl -X POST http://localhost:3000/api/recordUsage \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "appName": "Instagram",
    "closeTime": 1715001800
  }'

# Fetch usage stats
curl http://localhost:3000/api/usage/test-user/2025-05-05
```

### Using HTTP file (VS Code REST Client)

Save as `backend/test-requests.http`:

```http
### Record app opening (simulating Shortcut)
POST http://localhost:3000/api/recordUsage
Content-Type: application/json

{
  "userId": "test-user",
  "deviceId": "test-device",
  "appName": "Instagram",
  "openTime": 1715000000
}

### Record app closing
POST http://localhost:3000/api/recordUsage
Content-Type: application/json

{
  "userId": "test-user",
  "deviceId": "test-device",
  "appName": "Instagram",
  "closeTime": 1715001800
}

### Get usage stats
GET http://localhost:3000/api/usage/test-user/2025-05-05
```

Click "Send Request" above each block to test.

## Verifying Data in Firestore

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Select your project → Firestore Database
3. Look in `users/test-user/usage/2025-05-05/`
4. Verify data structure matches what you expect

## Basic Frontend Testing

Just test on Expo Go manually:

```bash
npm start
# Scan QR code with Expo Go
# Tap buttons, verify UI works
# Check console output (shake phone → View logs)
```

No formal tests needed for a class project at this stage.

## Quick Checklist

- [ ] POST /api/recordUsage returns 200 and creates data in Firestore
- [ ] GET /api/usage/{userId}/{date} returns correct data
- [ ] Firestore security rules allow reads/writes
- [ ] App displays data without crashing
- [ ] Push notifications send successfully (test via backend function)
