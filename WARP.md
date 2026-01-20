# WARP.md

This file provides guidance to WARP (warp.dev) and developers working with this repository.

## Project Overview

**School Portal** (Selene Monorepo) is a comprehensive marketplace and student portal application. It allows users to browse products, manage a shopping cart, list items for sale, and manage their profiles.

The project is structured as a **Monorepo** using **Bun Workspaces**, containing:
- **Frontend**: A React Native (Expo) mobile application.
- **Backend**: An Express.js server (auxiliary).
- **Types**: Shared TypeScript definitions.

## Key Features

- **Marketplace**: Full buy/sell flow with Cart (`useCartStore`), Search (`useSearchStore`), and Selling (`useSellStore`) capabilities.
- **Authentication**: Secure user management via **Supabase Auth** (Email/Password) and **Google Sign-in**.
- **Modern UI**: Built with **Shopify Restyle** for theming and **React Native Paper** for components.
- **Internationalization**: Multi-language support using `i18next`.
- **Navigation**: Tab-based main navigation with modal flows for selling and authentication.

## Tech Stack

### Frontend (`apps/frontend`)
- **Core**: React Native 0.81, React 19.1, Expo ~54.
- **Language**: TypeScript.
- **Routing**: Expo Router v6 (File-based routing).
- **Backend Services**:
  - **Supabase**: Database and Authentication (`@supabase/supabase-js`).
  - **Google Auth**: `@react-native-google-signin/google-signin`.
- **State Management**:
  - **Zustand**: Client-side global state (stores located in `core/store`).
  - **React Query**: Server-side state caching and management.
- **Styling**:
  - `@shopify/restyle`: Theme-based styling system.
  - `react-native-paper`: UI Component library.
  - `react-native-reanimated` & `moti`: Animations.
- **Forms**: `react-hook-form` + `zod` schema validation.
- **Assets**: `react-native-vector-icons`, `expo-image`.

### Backend (`apps/backend`)
- **Framework**: Express.js with TypeScript.
- **Role**: Auxiliary backend service (currently minimal).
- **Dev Tools**: `nodemon` for hot reloading.

## Environment Setup

To run the project, you must configure environment variables for Supabase and Google Sign-in.

1. Create a `.env` file in `apps/frontend` (or root if using Expo generic config):

```bash
# Supabase Configuration
EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Google Sign-in Configuration
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your_google_web_client_id
```

## Development Commands

### Installation
Initialize dependencies using Bun:
```bash
bun install
```

### Running Applications
- **Frontend**:
  ```bash
  bun run frontend
  # OR platform specific:
  cd apps/frontend && bun android
  cd apps/frontend && bun ios
  ```
- **Backend**:
  ```bash
  bun run backend
  ```

### Code Quality
- **Linting**: `bun run lint` (ESLint with Flat Config)
- **Formatting**: `bun run format` (Prettier)
- **Hooks**: Husky runs `lint-staged` on commit to ensure code quality.

## Architecture & Structure

### Directory Structure
```
├── apps
│   ├── frontend/       # Expo React Native App
│   │   ├── app/        # Expo Router screens (tabs, auth, modal)
│   │   ├── components/ # Reusable UI components
│   │   ├── core/       # Core logic (auth, db, stores, theme, i18n)
│   │   └── assets/     # Images, fonts, icons
│   └── backend/        # Express API
├── packages
│   └── types/          # Shared TypeScript types
```

### Navigation (`apps/frontend/app`)
- **`(tabs)`**: Main tab bar navigation.
  - `index` (Home), `search` (Search), `sell` (Sell Tab), `cart` (Shopping Cart), `profile` (User Profile).
- **`(auth)`**: Authentication stack (Login, Register).
- **`sell`**: Modal stack for the "Sell Item" flow.
- **`_layout.tsx`**: Root layout containing global providers:
  - `AuthProvider` & `AuthModalProvider` (Auth State)
  - `ThemeProvider` & `PaperProvider` (Styling)
  - `QueryClientProvider` (Data Fetching)

### Data Flow
1. **Authentication**:
   - Users sign in via `AuthModalProvider`.
   - `AuthProvider` listens to Supabase session changes.
2. **Data Fetching**:
   - Uses `React Query` to fetch data from Supabase or Backend.
   - Frontend connects directly to Supabase using `core/db/supabase.ts`.
3. **Global State**:
   - `useCartStore`: Manages shopping cart items.
   - `useSearchStore`: Manages search filters and results.
   - `useSellStore`: Manages state for the "Sell Item" wizard.

## Deployment / Builds
- **EAS Build**: Configured in `eas.json`.
- **Commands**:
  - Configure: `bun run eas:configure`
  - Dev Build: `bun run dev:install`
  - Production Build: `bun run eas:build`
