# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

School Portal is a monorepo containing a React Native mobile application (frontend) and Express backend, built with Bun as the JavaScript runtime.

## Development Commands

### Initial Setup
```bash
bun install
```

### Running Applications
- **Frontend (React Native/Expo)**: `bun run frontend`
  - Android: `cd apps/frontend && bun expo start --android`
  - iOS: `cd apps/frontend && bun expo start --ios`
  - Web: `cd apps/frontend && bun expo start --web`
- **Backend (Express)**: `bun run backend`

### Code Quality
- **Lint all code**: `bun run lint`
- **Format all code**: `bun run format`
- Lint-staged runs automatically on pre-commit via Husky

### Mobile Builds (EAS)
- **Configure EAS**: `bun run eas:configure`
- **Development build**: `bun run dev:install` (Android dev build)
- **Production build**: `bun run eas:build`

All EAS commands must be run from the `apps/frontend` directory.

## Architecture

### Monorepo Structure
The codebase uses Bun workspaces with three main workspace packages:
- `apps/frontend`: React Native mobile app using Expo
- `apps/backend`: Express API server
- `packages/types`: Shared TypeScript types used by both frontend and backend

### Frontend Architecture (`apps/frontend`)

**Technology Stack:**
- React Native 0.81.4 with React 19.1.0
- Expo ~54 with Expo Router for file-based routing
- Bun as the JavaScript runtime

**Routing:**
- Uses Expo Router (v6) with file-based routing in the `app/` directory
- Typed routes enabled via `experiments.typedRoutes` in app.json
- Tab-based navigation structure in `app/(tabs)`

**Styling System:**
- Dual theme providers: Shopify Restyle + React Native Paper
- Theme definitions in `core/theme/` export both `theme` (Restyle) and `paperTheme` (Paper)
- Base styled components (`Box`, `Text`) in `components/base/` built with Restyle's `createBox` and `createText`
- Both theme providers wrap the app in `app/_layout.tsx`

**Internationalization:**
- i18next with react-i18next for translations
- Configuration in `core/i18n/`
- Locale files organized by language and namespace (e.g., `locales/en/common.json`, `locales/es/auth.json`)
- Auto-detects device language using `expo-localization`
- Namespaces: `common`, `auth`

**State Management:**
- React Query (@tanstack/react-query) for server state
- Zustand for client state
- React Hook Form with Zod for form validation

**Key Configuration Files:**
- `app.json`: Expo configuration, EAS project ID
- `eas.json`: EAS Build profiles (development, preview, production)
- React Native New Architecture enabled (`newArchEnabled: true`)

### Backend Architecture (`apps/backend`)

**Technology Stack:**
- Express.js server
- TypeScript with nodemon for development
- CORS enabled for cross-origin requests

**Development:**
- Entry point: `src/index.ts`
- Dev server runs with `nodemon src/index.ts`
- Default port: 3001 (configurable via `PORT` env var)

### Shared Types (`packages/types`)

**Purpose:**
- Centralized TypeScript type definitions shared between frontend and backend
- Ensures type safety across the monorepo
- Both apps import types using workspace protocol: `@school/types`

**Usage:**
```typescript
import type { SharedUser } from '@school/types';
```

## Code Quality Standards

### ESLint Configuration
- Flat config format (`eslint.config.js`)
- TypeScript ESLint rules applied to `.js`, `.jsx`, `.ts`, `.tsx` files
- Prettier integration (conflicts disabled)
- Ignored paths: `node_modules/`, `.expo/`, `dist/`, `build/`, `apps/frontend/ios/`, `apps/frontend/android/`

### Git Hooks
- Pre-commit hook via Husky runs lint-staged
- Lint-staged auto-fixes TypeScript/JavaScript files on commit
