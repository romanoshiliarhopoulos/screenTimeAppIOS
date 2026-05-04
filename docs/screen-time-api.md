# Screen Time API Patterns

This document covers patterns for integrating with Apple's Screen Time API (Family Controls framework) in a development-only app.

## Overview

The Screen Time API (via `com.apple.developer.family-controls` entitlement) provides access to:

- App usage data (per-app screen time)
- Device activity reports
- Setting usage restrictions on specific apps

**Current Status:** This is a development-only app with no budget. Full Screen Time API access requires Apple's Family Controls entitlement, which may not be approved for class projects. We'll implement with graceful fallbacks.

## Key Limitations

1. **Physical Device Only** — Requires a real iOS device; simulator does not support Family Controls
2. **Entitlement Approval Uncertain** — Must have `com.apple.developer.family-controls` in provisioning profile (Apple approval required, may take weeks or be denied)
3. **User Consent Required** — Even with entitlement, the user must grant Screen Time access in Settings → Screen Time
4. **Fallback Required** — Design the app to work with limited data if entitlement is denied

## Integration Pattern

### With Family Controls Entitlement (Full Access)

Place all Screen Time API interactions in `src/native/ScreenTimeManager.ts`:

```typescript
// src/native/ScreenTimeManager.ts
import { NativeModules } from "react-native";

const { ScreenTimeManager } = NativeModules;

export const getAppScreenTime = async (bundleId: string): Promise<number> => {
  return ScreenTimeManager.getAppScreenTime(bundleId);
};

export const getAllAppsScreenTime = async (): Promise<
  Record<string, number>
> => {
  return ScreenTimeManager.getAllAppsScreenTime();
};
```

### Without Family Controls Entitlement (Fallback Approach)

If Apple denies the entitlement, implement custom tracking:

```typescript
// src/native/CustomScreenTimeManager.ts
// Fallback: Track app launches/closures within our app
// This won't give real system-wide screen time, but demonstrates doomscroll patterns

export const logAppInteraction = async (
  appName: string,
  bundleId: string,
  action: "open" | "close"
): Promise<void> => {
  // Log to local database or analytics
  // User can see their usage patterns within this app
};

export const getEstimatedScreenTime = async (
  bundleId: string
): Promise<number> => {
  // Return estimated time based on user interactions logged in-app
  // Or ask user to manually input screen time from Settings
};
```

### Usage in React Components

Always wrap native calls in error handling:

```typescript
const [screenTime, setScreenTime] = useState<number | null>(null);
const [hasEntitlement, setHasEntitlement] = useState(true);

useEffect(() => {
  getAppScreenTime("com.example.app")
    .then(setScreenTime)
    .catch((err) => {
      if (err.message.includes("entitlement")) {
        setHasEntitlement(false);
        // Fall back to custom tracking or manual input
      } else {
        console.error("Failed to fetch screen time:", err);
      }
    });
}, []);
```

## Testing Without Device

- Mock `ScreenTimeManager` in tests
- Use dummy data that matches real API shape
- Test error cases (permission denied, entitlement missing, etc.)
- Test fallback behavior when entitlement is unavailable

## Distribution for Data Collection

### TestFlight (Recommended)
- Apple's free beta testing platform
- Invite testers via email or public link
- Up to 10,000 testers
- Automatic crash logs and basic analytics
- No cost

### Ad-Hoc Provisioning
- For small groups (< 10 testers)
- Register device UDIDs in Apple Developer account (free)
- Share signed .ipa file
- Tester connects device to Mac or uses ad-hoc link

### Development Installation
- Direct installation via Xcode for physical testing
- Requires tester's device connected to your Mac
- Best for in-person demos

## Common Issues

| Issue                         | Solution                                                             |
| ----------------------------- | -------------------------------------------------------------------- |
| "Entitlement missing" error   | Check provisioning profile has `com.apple.developer.family-controls` |
| Always returns 0 or undefined | Verify user enabled Screen Time in device settings                   |
| Works in simulator            | Simulator doesn't support Family Controls; test on physical device   |
| Entitlement denied by Apple   | Switch to fallback approach (custom tracking or manual input)        |

## References

- [Apple Family Controls Framework](https://developer.apple.com/documentation/familycontrols)
- [DeviceActivityReport](https://developer.apple.com/documentation/familycontrols/deviceactivityreport)
