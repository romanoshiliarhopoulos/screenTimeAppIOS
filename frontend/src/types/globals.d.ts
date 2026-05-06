// Expo replaces process.env.EXPO_PUBLIC_* at build time via babel.
// This declaration makes TypeScript aware of the global `process` object.
declare const process: { env: Record<string, string | undefined> };
