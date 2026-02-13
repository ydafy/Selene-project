# Repository Guidelines

## Project Overview

**Selene** is a start app specialized Marketplace for used PC Hardware (GPUs, CPUs, RAMs, Motherboards) in Mexico with a focus on trust and verification through technical validation.

### Monorepo Structure

```
├── apps/
│   ├── frontend/     # Expo React Native App
│   └── backend/      # Express API
└── packages/
    └── types/        # Shared TypeScript types
```

### Tech Stack

- **Runtime**: Bun
- **Frontend**: React Native (Expo Managed), TypeScript (strict)
- **Backend**: Express with Supabase BaaS
- **Navigation**: Expo Router (file-based routing)
- **State Management**: Zustand (client), TanStack Query (server)
- **Styling**: Shopify Restyle + React Native Paper
- **Database**: Postgres via Supabase

---

## Development Commands

### Root Level Commands

```bash
bun install              # Install dependencies
bun run frontend         # Run React Native app
bun run backend          # Run Express API
bun run lint             # ESLint for all files
bun run format           # Prettier formatting
```

### Frontend Specific (cd apps/frontend)

```bash
bun run start            # Start Expo dev server
bun run android          # Run on Android
bun run ios              # Run on iOS
bun run web              # Run on Web
```

### Backend Specific (cd apps/backend)

```bash
bun run dev              # Start dev server with nodemon
```

---

## How to Work in This Repository

Before generating or modifying code:

1. **Explore existing codebase** - Read related files
2. **Identify reusable patterns** - Components, hooks, utilities
3. **Invoke appropriate skill** - Use the skill matching your task
4. **Never introduce new patterns** - Reuse existing ones

---

## Available Skills

| Skill         | Description                              | URL                                       |
| ------------- | ---------------------------------------- | ----------------------------------------- |
| architect     | Plan architecture and structure          | [SKILL.md](skills/architect/SKILL.md)     |
| ui-designer   | Build consistent UI with Design System   | [SKILL.md](skills/ui-designer/SKILL.md)   |
| refactor      | Improve code quality and maintainability | [SKILL.md](skills/refactor/SKILL.md)      |
| expo-frontend | Handle Expo Router, native APIs, configs | [SKILL.md](skills/expo-frontend/SKILL.md) |

---

## Auto-invoke Skills

When performing these actions, ALWAYS invoke the corresponding skill FIRST:

| Action                                  | Required Skill              |
| --------------------------------------- | --------------------------- |
| Designing a new screen                  | ui-designer + expo-frontend |
| Refactoring any file                    | refactor                    |
| Adding reusable UI                      | expo-frontend               |
| Moving logic to hooks or core           | refactor                    |
| Planning folder structure for a feature | architect                   |
| Working with API routes or services     | express-backend             |

---

## Folder Responsibilities

- `app/` → Screens and navigation (Expo Router)
- `components/` → Reusable UI components only
- `components/ui/` → Generic UI components (buttons, inputs, cards)
- `components/features/` → Feature-specific components
- `core/` → Logic (auth, db, stores, theme, i18n)
- `core/hooks/` → Custom React hooks
- `core/store/` → Zustand state stores
- `packages/types` → Shared types across the entire repo

---

## Code Style Guidelines

### TypeScript Rules

- **Strict mode enabled** - No `any` types allowed
- Always define interfaces in `packages/types`
- Use shared types from `@selene/types` workspace package

### Import Conventions

- Use absolute paths or clean relative paths
- Import from workspace packages: `import { Product } from '@selene/types'`
- Group imports: external libraries, internal modules, relative imports

### Styling & UI

- Use `Box` and `Text` from `components/base` instead of raw `View/Text`
- Follow theme system via `@shopify/restyle`
- Use semantic typography variants (header-2xl, body-md, caption-sm)
- Prefer reusable components in `components/ui` or `components/features`

### Component Architecture

- Create small, reusable components
- Follow existing patterns in the codebase
- Use file-based routing with Expo Router
- Wizards and complex state: use Zustand stores

### Internationalization

- **Never hardcode strings** - always use `useTranslation` hooks
- Translation files: `sell.json`, `common.json`, `verify.json`
- Import and initialize i18n: `import '../core/i18n'`

### Error Handling

- Use React Query for server state error handling
- Implement proper error boundaries
- Use consistent error state components like 'components/ui/errorState.tsx'
- Follow Supabase error patterns

### Naming Conventions

- **Components**: PascalCase (e.g., `ProductCard`, `SellWizard`)
- **Files**: Match component names
- **Hooks**: camelCase starting with `use` (e.g., `useProductSearch`)
- **Constants**: UPPER_SNAKE_CASE in dedicated files
- **Types**: PascalCase interfaces in `packages/types`

---

## Code Quality Tools

### ESLint Configuration

- TypeScript ESLint with recommended rules
- Prettier integration
- Flat config format in `eslint.config.js`
- Ignores: `node_modules/`, `.expo/`, `dist/`, `build/`, platform folders

### Prettier Configuration

```javascript
{
  arrowParens: 'always',
  bracketSpacing: true,
  jsxSingleQuote: false,
  printWidth: 80,
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'all',
}
```

### Git Hooks

- Husky for pre-commit hooks
- lint-staged runs Prettier and ESLint on staged files
- Automatic formatting on commit

---

## Key Patterns & Conventions

### State Management Patterns

- **Server State**: TanStack Query with proper keys and caching
- **Client State**: Zustand for complex UI state (wizards, forms)
- **Form State**: React Hook Form with Zod resolvers

### Database Schema

- `products` - Items with status ('PENDING_VERIFICATION', 'IN_REVIEW', 'VERIFIED', 'SOLD', 'REJECTED')
- `notifications` - In-app alerts with `read`, `type`, `action_path`
- `addresses` - User shipping info with `is_default` flag

---

## Agent Guidelines

1. **Read existing files** before proposing changes
2. **Reuse patterns** - don't create new components if similar exists
3. **Follow conventions** strictly - theme, providers, folder structure
4. **Prefer refactoring** over creating new code
5. **Maintain consistency** with existing architecture
6. **Use shared types** from `packages/types` religiously
7. **Internationalize all strings** - no hardcoded text
8. **Respect the design system** - use defined typography and spacing
9. **Invoke appropriate skill** before making changes

---

## Environment Setup

- Use Bun as runtime and package manager
- Configure `.env` with required variables (Google OAuth, Supabase)
- Expo CLI for mobile development
- EAS CLI for builds and deployments
