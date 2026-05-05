# Deployment Guide

Complete guide for deploying the React Native app and backend infrastructure (zero cost).

## Table of Contents

1. [Frontend Deployment](#frontend-deployment) — Expo Go (instant) or Expo build
2. [Backend Deployment](#backend-deployment) — Vercel Functions
3. [Database Setup](#database-setup) — Firestore
4. [Push Notifications](#push-notifications) — APNs setup

## Frontend Deployment

### Option 1: Expo Go (Instant Testing)

Best for early development and testing with friends on the same network.

**Setup:**
```bash
npm install
npm start
```

**For friends to test:**
1. Install Expo Go app (free, App Store)
2. When you run `npm start`, a QR code appears
3. Friend scans with Expo Go on their iPhone
4. App opens and live-reloads as you code

**Pros:** Instant, no builds, live updates  
**Cons:** Requires same network (or Expo tunnel), not persistent

### Option 2: Expo Build (Persistent App)

For distributing a standalone iOS app without Xcode or App Store.

**Setup:**
```bash
npm install -g eas-cli
eas build --platform ios
```

**First time only:**
- Answer prompts about credentials
- EAS handles signing (free tier)
- Creates iOS app (.ipa file)

**What you get:**
- iOS app file to share
- Friends can install via email link or TestFlight-like interface
- Persists on their device

**Pros:** Standalone app, no dependency on Expo Go  
**Cons:** Takes ~10-15 min to build

**Share the build:**
```bash
# After build completes, get the link:
eas build:list
# Share the .ipa link with friends
```

**For distribution:** Create a simple landing page:
```html
<!-- public/download.html -->
<h1>Stop Doomscrolling — Test Build</h1>
<p><a href="[EAS build link]">Download iOS App</a></p>
<p>Or scan to install via TestFlight link (if published)</p>
```

## Backend Deployment

### Prerequisites

- Vercel account (free tier)
- Git repository (GitHub)

### Step 1: Create Vercel Project

```bash
# Option A: CLI
vercel --prod

# Option B: Via vercel.com
# 1. Go to vercel.com
# 2. Click "Add New" → Project
# 3. Import your GitHub repo
# 4. Click Deploy
```

### Step 2: Set Environment Variables

Create `backend/.env.local`:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_CLIENT_EMAIL=your-email@iam.gserviceaccount.com
EXPO_PUSH_TOKEN=your-expo-push-token
```

Push to Vercel:

```bash
vercel env add FIREBASE_PROJECT_ID
# Paste value and press enter
# Repeat for other vars
```

### Step 3: Deploy

```bash
# Automatic: Push to GitHub main branch
git push origin main

# Or manual:
vercel --prod
```

**Your API is now live at:**
```
https://your-project.vercel.app/api/recordUsage
https://your-project.vercel.app/api/usage/[userId]/[date]
```

### Vercel Functions Structure

```
api/
├── recordUsage.ts      → https://your-project.vercel.app/api/recordUsage
├── usage/
│   └── [userId]/
│       └── [date].ts   → https://your-project.vercel.app/api/usage/[userId]/[date]
└── notifications/
    └── [userId].ts     → https://your-project.vercel.app/api/notifications/[userId]
```

## Database Setup

### Firestore (Google Cloud)

**Cost:** Free tier (1GB storage, 50k reads/day) — more than enough

**Setup:**

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click "Add Project"
3. Enter project name: `stop-doomscrolling`
4. Enable Google Analytics (optional)
5. Click "Create Project"

**After project is created:**

6. Go to Firestore Database
7. Click "Create Database"
8. Region: `us-east1` (closest to you)
9. Mode: **Start in test mode** (easier to test)

**Add security rules later:**
```
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

**Database structure:**
```
users/
  └── {userId}/
      ├── profile (name, email, etc.)
      ├── preferences (which apps to track)
      └── usage/
          └── {date}/
              ├── Instagram: { sessions: [...], totalDuration: 3600 }
              ├── TikTok: { sessions: [...], totalDuration: 1800 }
              └── ...
```

**Test it:**
```bash
# In backend function:
const db = admin.firestore();
const doc = await db.collection('users').doc('user123').get();
console.log(doc.data());
```

### Connecting from Vercel Functions

```typescript
// backend/functions/api/recordUsage.ts
import * as admin from 'firebase-admin';

admin.initializeApp({
  projectId: process.env.FIREBASE_PROJECT_ID,
  privateKey: process.env.FIREBASE_PRIVATE_KEY,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
});

const db = admin.firestore();

export default async (req, res) => {
  const { userId, appName, openTime, closeTime } = req.body;

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  await db
    .collection('users')
    .doc(userId)
    .collection('usage')
    .doc(today)
    .update({
      [appName]: admin.firestore.FieldValue.serverTimestamp(),
    });

  res.json({ success: true });
};
```

## Push Notifications

### Step 1: Get Expo Push Token

In your React Native app:

```typescript
// src/hooks/usePushNotifications.ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

export const usePushNotifications = (userId: string) => {
  useEffect(() => {
    registerForPushNotifications();
  }, []);

  const registerForPushNotifications = async () => {
    if (!Device.isDevice) {
      console.log('Must use physical device for push notifications');
      return;
    }

    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      console.log('Permission denied');
      return;
    }

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    
    // Send token to backend
    await fetch('https://your-backend.com/api/savePushToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, expoPushToken: token }),
    });
  };
};
```

### Step 2: Configure Notification Handlers

```typescript
// In your main App component
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

useEffect(() => {
  const subscription = Notifications.addNotificationResponseListener(
    (response) => {
      // User tapped the notification
      console.log('Notification tapped:', response.notification.request.content.body);
    }
  );

  return () => subscription.remove();
}, []);
```

### Step 3: Send Notifications from Backend

```typescript
// backend/functions/triggers/onHighUsage.ts
export const onHighUsage = functions.firestore
  .document('users/{userId}/usage/{date}')
  .onWrite(async (change, context) => {
    const { userId } = context.params;
    const data = change.after.data();

    // Check if any app > 3 hours
    let shouldNotify = false;
    for (const [appName, sessionData] of Object.entries(data)) {
      if (sessionData.totalDuration > 3 * 3600) {
        shouldNotify = true;
        break;
      }
    }

    if (!shouldNotify) return;

    // Get user's push token
    const user = await db.collection('users').doc(userId).get();
    const { expoPushToken } = user.data();

    if (!expoPushToken) return;

    // Send via Expo
    const message = {
      to: expoPushToken,
      sound: 'default',
      title: '⏰ High Screen Time',
      body: `You've spent ${Math.round(totalDuration / 3600)}h on doomscroll apps today`,
    };

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    return response.json();
  });
```

### Step 4: Test Notifications

```bash
# Send test notification
curl -X POST https://your-backend.com/api/sendNotification \
  -H "Content-Type: application/json" \
  -d '{
    "expoPushToken": "ExponentPushToken[...]",
    "title": "Test",
    "body": "This is a test"
  }'
```

## Environment Variables Checklist

**Vercel:**
- `FIREBASE_PROJECT_ID`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_CLIENT_EMAIL`
- `EXPO_PUSH_TOKEN` (optional, for testing)

**Frontend (.env.local):**
```env
EXPO_PUBLIC_API_URL=https://your-backend.vercel.app
EXPO_PUBLIC_ENVIRONMENT=production
```

## Monitoring

### Vercel
```bash
vercel logs                    # Stream logs
vercel env list               # Check env vars
```

### Firestore
- Console: [firebase.google.com](https://firebase.google.com)
- Usage: Check "Usage" tab (free tier limits)

### Expo
```bash
eas build:list                # Check build history
eas update:list               # Check app updates
```

## Cost Summary

| Service | Free Tier | What It Gives |
|---------|-----------|---|
| Vercel Functions | 100 GB bandwidth/month | API endpoints |
| Firestore | 1GB storage, 50k reads/day | Database |
| Expo | Unlimited apps | Frontend distribution |
| Expo Push | Unlimited | Push notifications |
| **Total** | **$0/month** | **Full app** |

## Troubleshooting

**API returns 404:**
- Check Vercel deployment status: `vercel --prod`
- Check function name matches route
- Check environment variables are set

**Firestore writes fail:**
- Check security rules allow writes
- Check Firebase credentials in env vars
- Check Firestore database is created

**Push notifications not arriving:**
- Check expoPushToken is valid
- Check notification handler is registered
- Check device has notification permission enabled

## Next Steps

1. Deploy backend to Vercel (`vercel --prod`)
2. Create Firestore database
3. Test API with curl (see [Testing Guide](testing.md))
4. Set up push notifications (steps above)
5. Deploy frontend with Expo Build
6. Share Shortcuts and app link with friends
