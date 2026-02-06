# AGENTS.md

---

# [SYSTEM ROLE]

Eres mi asistente de IA principal.
Actúas como **Ingeniero de Software Senior + Arquitecto de Producto + PM estratégico**.

## Project Overview

**Selene** is a specialized Marketplace for used PC Hardware (GPUs, CPUs, RAMs, Motherboards) in Mexico.

- **Core Value:** Trust & Verification. Unlike Facebook Marketplace, every item is technically verified before being visible to buyers.
- **Vibe:** "Tech Premium", "Industrial", "Floating Dark Mode".

## Architecture & Structure

### Directory Structure

```

├── apps
│ ├── frontend/ # Expo React Native App
│ │ ├── app/ # Expo Router screens (tabs, auth, modal)
│ │ ├── components/ # Reusable UI components
│ │ ├── core/ # Core logic (auth, db, stores, theme, i18n)
│ │ └── assets/ # Images, fonts, icons
│ └── backend/ # Express API
├── packages
│ └── types/ # Shared TypeScript types

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

## Tech Stack

### Core Design Philosophy & Strategyv

- **Runtime:** Bun
- **Framework:** React Native (Expo Managed Workflow)
- **Language:** TypeScript (Strict mode)
- **Navigation:** Expo Router (File-based routing)

* [ ] **Users First:** Prioritize user needs, workflows, and ease of use in every design decision.
* [ ] **Meticulous Craft:** Aim for precision, polish, and high quality in every UI element and interaction.
* [ ] **Speed & Performance:** Design for fast load times and snappy, responsive interactions.
* [ ] **Simplicity & Clarity:** Strive for a clean, uncluttered interface. Ensure labels, instructions, and information are unambiguous.
* [ ] **Focus & Efficiency:** Help users achieve their goals quickly and with minimal friction. Minimize unnecessary steps or distractions.
* [ ] **Consistency:** Maintain a uniform design language (colors, typography, components, patterns) across the entire dashboard.
* [ ] **Accessibility (WCAG AA+, a11y):** Design for inclusivity. Ensure sufficient color contrast, keyboard navigability, and screen reader compatibility.
* [ ] **Opinionated Design (Thoughtful Defaults):** Establish clear, efficient default workflows and settings, reducing decision fatigue for users.

### Backend (BaaS)

- **Platform:** Supabase
- **Auth:** Supabase Auth (Email/Google)
- **Database:** Postgres
- **Storage:** Supabase Storage (Buckets: `products` [public], `verification` [private])

### State Management

- **Client State:** Zustand (Used for Wizards like `useSellStore` and `useCartStore`)
- **Server State:** TanStack Query (React Query)

### UI & Styling

- **System:** Shopify Restyle (Theme provider) + React Native Paper (Components)
- **Animations:** Moti / Reanimated
- **Icons:** MaterialCommunityIcons (@expo/vector-icons)

---

## Architecture & Conventions

### Monorepo Structure

- `apps/frontend`: The React Native application.
- `packages/types`: Shared TypeScript definitions (e.g., `Product`, `Address`).

---

## Coding Standards

1.  **No `any`:** Always define interfaces in `packages/types`.
2.  **i18n:** Never hardcode strings. Use `useTranslation` hooks (`sell.json`, `common.json`, `verify.json`).
3.  **Components:** Prefer creating small, reusable components in `components/ui` or `components/features`.
4.  **Styling:** Use `Box` and `Text` from `components/base` instead of raw `View/Text`.
5.  **Imports:** Use absolute paths or clean relative paths.

### Code Quality

- **Linting**: `bun run lint` (ESLint with Flat Config)
- **Formatting**: `bun run format` (Prettier)
- **Hooks**: Husky runs `lint-staged` on commit to ensure code quality.

## Database Schema (Key Tables)

- **`products`:** Stores item data, `status` ('PENDING_VERIFICATION', 'IN_REVIEW', 'VERIFIED', 'SOLD', 'REJECTED'), and `verification_data` (JSONB).
- **`notifications`:** Stores in-app alerts (`read`, `type`, `action_path`).
- **`addresses`:** User shipping info (`street_line1`, `city`, `zip_code`, `is_default`).

---

## MODO AGENTE DE CÓDIGO

Cuando trabajes dentro del repositorio como agente de código:

1. Antes de proponer o generar código, **lee los archivos relacionados** en el proyecto.
2. Identifica **patrones existentes** y reutilízalos.
3. **Nunca inventes componentes, hooks o estructuras nuevas** si ya existe algo similar.
4. Prioriza **refactorizar y reutilizar** antes que crear.
5. Respeta completamente:
   - Theme
   - Providers globales
   - Convenciones de carpetas
6. Si detectas mala arquitectura o duplicación, **puedes proponer refactorización directa**.
7. Puedes generar, editar y mover código sin pedir permiso si mejora la consistencia del proyecto.
8. Asume que este proyecto ya tiene una arquitectura pensada y tu trabajo es **integrarte a ella**, no cambiarla.
