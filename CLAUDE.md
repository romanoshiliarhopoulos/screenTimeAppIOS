# Development Guide

This document provides essential context for Claude agents working on this project.

## Project Overview

This is an iOS app that helps users break the doomscrolling habit and goal is to restore slow, effortful thinking. Built with React Native (Expo), it uses iOS Shortcuts automations to collect app usage data and a serverless backend to analyze and visualize the data.

**Purpose:** Computer Interface class project (development/internal use only)  
**Target Platform:** iOS (via Expo — no Apple Developer account required)  
**Tech Stack:** React Native (Expo), Firestore, Vercel Functions, iOS Shortcuts  
**Budget:** Zero — all tools and services use free tiers

## Before Starting Any Task

1. **Review the architecture** — [Architecture Overview](docs/architecture.md)
2. **Understand Shortcuts integration** — [iOS Shortcuts Integration](docs/shortcuts-integration.md)
3. **Learn deployment** — [Deployment Guide](docs/deployment.md)
4. **Follow testing conventions** — [Testing Guide](docs/testing.md)

## Architecture Overview

**Three-Layer Design:**

1. **Data Collection Layer** — iOS Shortcuts automations (user-configured)
   - Users create Shortcuts that trigger on app open/close
   - Shortcuts send: `{ userId, deviceId, appName, openTime, closeTime }` to backend
   - No native code required; users control what data is collected

2. **Frontend Layer** — React Native app via Expo
   - Display app usage statistics and trends
   - Receive push notifications from backend
   - Settings for which apps to track
   - Easy distribution via Expo Go (instant testing)

3. **Backend Layer** — Serverless (Vercel + Firestore)
   - API endpoints to receive Shortcuts data
   - Store and process usage data in Firestore
   - Send push notifications to app (via APNs)
   - No servers to maintain, scales automatically

## Key Constraints

- **No Native Modules:** Shortcuts automate data collection — the app receives data, not collects it
- **Expo-Only:** No Xcode builds needed. Use Expo Go for instant testing.
- **Free Tier Limits:** Firestore (50k reads/day, 1GB storage) and Vercel (100GB bandwidth/month) are sufficient for class testing
- **iOS Shortcuts Required:** Users must set up Shortcuts automations to collect data (not automatic)
- **APNs Simplified:** Expo handles certificate management; backend triggers notifications

## Code Conventions

- Use functional components in React Native
- Organize code: `src/screens/`, `src/components/`, `src/hooks/`, `src/utils/`
- No native modules (`src/native/`) needed initially — Expo + Shortcuts handle integration
- Keep backend logic in `backend/` (Vercel Functions or Firebase Cloud Functions)
- Store database schemas and Firestore rules in `backend/firestore-rules/`

## Distribution

### For Friends Testing

**Expo Go (Instant — Recommended):**
```bash
npm install
npm start  # Scans QR code with Expo Go app
```

**Expo Build (Standalone):**
```bash
eas build --platform ios  # Free tier available
```

No TestFlight, no Apple Developer account needed.

### For Collecting Data

Users set up iOS Shortcuts via iCloud links you provide. See [Shortcuts Integration](docs/shortcuts-integration.md) for setup.

## Common Tasks

- Adding a new screen: Create component in `src/screens/`, add route to navigator
- Adding a stat visualization: Create component in `src/components/`, fetch data from backend
- Creating a Shortcut: Use the template from `backend/shortcuts/` and share iCloud link
- Testing backend API: Use `backend/test-requests.http` to send mock Shortcuts data

## Getting Help

- **Architecture questions:** See [Architecture Overview](docs/architecture.md)
- **Shortcuts setup:** See [iOS Shortcuts Integration](docs/shortcuts-integration.md)
- **Deployment issues:** See [Deployment Guide](docs/deployment.md)
- **Test failures:** See [Testing Guide](docs/testing.md)
