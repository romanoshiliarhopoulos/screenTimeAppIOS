# Architecture Overview

 A React Native iOS app with a three-layer architecture. **This is a development-only, zero-budget class project.**

## Layer 1: Native (iOS/Swift)

**Location:** `ios/` and `src/native/`

Handles:

- Screen Time API calls (requires Family Controls entitlement — may be denied)
- Fallback custom tracking if entitlement unavailable
- Device-level permissions and settings
- Background tasks (if needed)

**Exposure:** Swift → Typescript via `RCTBridgeModule`

**Strategy:**
1. First attempt: Request Family Controls entitlement from Apple
2. If denied: Fall back to custom tracking (app launches/closures logged in our app)
3. Alternative: Ask users to manually input screen time from device Settings

## Layer 2: React Native (JavaScript/TypeScript)

**Location:** `src/`

Structure:

```
src/
├── screens/        # Full-screen views (e.g., DashboardScreen, SettingsScreen)
├── components/     # Reusable UI components
├── native/         # JS wrappers around native modules
├── hooks/          # Custom React hooks (state, API calls)
├── store/          # State management (if using Redux/Zustand)
├── types/          # TypeScript definitions
└── utils/          # Helper functions
```

**Key Principles:**

- Components are functional (hooks-based)
- Native logic is abstracted into `src/native/*` modules
- State is managed centrally (avoid prop drilling)
- All Screen Time data flows through native modules

## Layer 3: UI/Screens

**Key Screens:**

1. **Dashboard** — Shows today's screen time and top apps
2. **App Limits** — Set usage limits per app
3. **Insights** — Weekly/monthly trends
4. **Settings** — User preferences and permissions

## Data Flow

```
iOS Device Screen Time Data
        ↓
  [ScreenTimeManager.swift]
        ↓
  [ScreenTimeManager.ts] (React Native Bridge)
        ↓
  [useScreenTime Hook]
        ↓
  [React Components]
        ↓
  [UI Display]
```

## State Management

For now, keep state simple with React hooks. If complexity grows, consider:

- Redux (if time-travel debugging is valuable)
- Zustand (if you prefer less boilerplate)
- Jotai (if you like atomic state)

**Decision:** Defer state lib choice until state grows beyond 2-3 screens.

## Navigation

Use React Navigation's Stack Navigator:

- Home Stack (Dashboard, App Details)
- Settings Stack (Preferences, Limits)
- Modal Stack (Onboarding, Permission Requests)

## Performance Considerations

- **Screen Time queries are expensive** — Cache results, refresh on intervals (e.g., every 60s)
- **Minimize native calls** — Batch requests when possible
- **Background refresh** — Use native scheduled tasks, not JS timers
