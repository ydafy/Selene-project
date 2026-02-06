---
name: expo-frontend
description: Handle tasks specific to the Expo and React Native ecosystem, such as navigation, native APIs, and project configuration.
trigger: When working with Expo Router, device APIs (Camera, Filesystem), or build configurations.
allowed-tools: Read, Write, Edit, Glob, Bash
---

## Purpose

This skill ensures that interactions with the native layer are handled correctly, safely, and follow Expo's best practices.

---

## Core Competencies (REQUIRED)

✅ ALWAYS:

- **Navigation:**
  - Use `useRouter` from `expo-router` for navigation.
  - Use `router.push` for forward navigation and `router.back` for reverse.
  - Use `<Stack.Screen>` to configure headers and presentation styles.
- **State & Data:**
  - Fetch server data with `useQuery` (TanStack).
  - Manage global client state with `useStore` (Zustand).
- **Native APIs:**
  - When using packages like `expo-image-picker`, always check for permissions first.
  - Handle both success and cancellation states.
- **Configuration:**
  - Store secret keys (`API Keys`) in `.env` files with the `EXPO_PUBLIC_` prefix.
  - Explain when a new `eas build` is required (e.g., after installing a new native library).

❌ NEVER:

- Use deprecated navigation libraries (`@react-navigation/stack`).
- Assume permissions are granted.
- Hardcode secret keys in the source code.

---

## Output Format

When generating code related to Expo:

1.  Include all necessary imports from `expo-router`, `expo-*` packages, etc.
2.  If a native API is used, include the permission-checking logic.
3.  If a change requires a new build, explicitly state it in the instructions.
