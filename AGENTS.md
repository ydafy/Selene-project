# Repository Guidelines

## Project Overview

**Selene** is a startup specialized Marketplace for used PC Hardware (GPUs, CPUs, RAMs, Motherboards) in Mexico with a focus on trust and verification through technical validation.

### Monorepo Structure

```
├── apps/
│   ├── frontend/     # Expo React Native App (Mobile)
│   ├── admin-web/   # Admin Web Dashboard (React + Vite + Tailwind)
│   └── backend/     # Express API (if used)
├── packages/
│   └── types/       # Shared TypeScript types
└── supabase/
    └── functions/    # Edge Functions (Stripe, Envia, Disputes)
```

### Tech Stack

- **Runtime**: Bun
- **Frontend (Mobile)**: React Native (Expo Managed), TypeScript (strict)
- **Frontend (Admin)**: React + Vite + TypeScript + Tailwind CSS
- **Backend**: Supabase BaaS (Postgres + Edge Functions)
- **Navigation (Mobile)**: Expo Router (file-based routing)
- **State Management**: Zustand (client), TanStack Query (server)
- **Styling (Mobile)**: Shopify Restyle (theme tokens, Box/Text components)
- **Styling (Admin)**: Tailwind CSS (custom dark theme)
- **External Services**: Stripe (payments), Envia.com (shipping/tracking)
- **Database**: Postgres via Supabase

---

## Development Commands

### Root Level Commands

```bash
bun install              # Install dependencies
bun run frontend        # Run React Native app
bun run admin-web      # Run Admin Web Dashboard
bun run lint            # ESLint for all files
bun run format          # Prettier formatting
bun db:types            # Updates supabase types
```

### Frontend Specific (apps/frontend)

```bash
bun run start           # Start Expo dev server
bun run android         # Run on Android
bun run ios             # Run on iOS
bun run web             # Run on Web
```

### Admin Web Specific (apps/admin-web)

```bash
bun run dev             # Start Vite dev server
bun run build           # Production build
```

### Supabase Functions

```bash
supabase functions serve    # Local development
supabase functions deploy   # Deploy to production
```

---

## How to Work in This Repository

Before generating or modifying code:

1. **Explore existing codebase** - Read related files
2. **Identify reusable patterns** - Components, hooks, utilities
3. **Invoke appropriate skill** - Use the skill matching your task
4. **Scalable and maintainable architecture** - Never temporary patches, always solid code from line 0
5. **Propose ideas and discuss ideas/code** - Propose ideas for the project/code
6. **TypeScrip** - Use typescrip best practices always

---

## Type First (MANDATORY)

Before writing ANY code that touches the database, queries a table, or references a DB column or type ALWAYS:

1. **Read `packages/types/src/database.types.ts`** — verify the column exists, the type is correct, and the FK relationship is defined.
2. **Read `packages/types/src/index.ts`** — use the exported aliases (`Tables<'orders'>`, `Enums<'order_status_enum'>`) instead of raw type lookups.
3. **Never guess a column name, table name, or type** — if it's not in the types file, it doesn't exist yet.

---

# Skill Auto-Invoke Rules

**The single source of truth for all skills is `.atl/skill-registry.md`.** That file is the authoritative index — do not duplicate it here. When installing or updating a skill, refresh the registry with `gentle-ai skill-registry refresh --force`.

## When to Load Skills

**When performing these actions, **ALWAYS** invoke the corresponding skill FIRST:**

| Trigger                               | Invoke First                                | Reason                                                       |
| ------------------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| Create or modify mobile UI/components | `building-native-ui` + `design-mobile-apps` | Follow native patterns and good UX                           |
| Create or edit forms                  | `react-hook-form` + `zod`                   | Robust validation                                            |
| Work with styles or visual design     | `tailwind-css-patterns`                     | Visual consistency across the project                        |
| Work with Supabase / Postgres         | `supabase-postgres-best-practices`          | Best practices and security                                  |
| Any data fetching or API calls        | `native-data-fetching`                      | Professional data handling                                   |
| Create/modify API routes              | `expo-api-routes`                           | Correct structure                                            |
| Improve accessibility                 | `accessibility`                             | Meet WCAG standards                                          |
| Deployment, builds or releases        | `expo-deployment`                           | Official Expo flow                                           |
| Update Expo SDK                       | `upgrading-expo`                            | Avoid common issues                                          |
| Complex logic or advanced types       | `typescript-advanced-types`                 | Better type safety                                           |
| Configure CI/CD or workflows          | `expo-cicd-workflows`                       | Recommended pipelines                                        |
| Modify state slices or store logic    | `zustand`                                   | Ensure consistent action patterns and performance            |
| Implementation of payments or billing | `stripe-best-practices`                     | Enforce security and correct API selection                   |
| Database schema or Auth changes       | `supabase`                                  | Handle migrations and RLS policies correctly                 |
| Adding charts or SaaS metrics         | `kpi-dashboard-design`                      | Follow visualization best practices and calculation accuracy |
| Hardcoded strings or new languages    | `i18n-localization`                         | Maintain clean localization files and internationalization   |
| Using git commands                    | `caveman-commit`                            | Maintain clean git commits and git commands                  |
| Dashboard web testing or debugging    | `webapp-testing`                            | Test and debug admin panel features with Playwright          |

---

## Folder Responsibilities

### Frontend (apps/frontend)

- `app/` → Screens and navigation (Expo Router)
- `components/` → Reusable UI components only
- `components/ui/` → Generic UI components (buttons, inputs, cards)
- `components/features/` → Feature-specific components
- `core/` → Logic (auth, db, stores, theme, i18n)
- `core/hooks/` → Custom React hooks
- `core/store/` → Zustand state stores
- `packages/types` → Shared types across the entire repo

### Admin Web (apps/admin-web)

- `src/pages/` → Page components (file-based routing via React Router)
- `src/components/ui/` → Reusable UI components (Tailwind)
- `src/components/features/` → Feature-specific components
- `src/hooks/` → Custom React hooks (TanStack Query)
- `src/lib/` → Utilities (Supabase client, helpers)
- `src/store/` → Zustand stores
- `src/types/` → Local TypeScript types

### Supabase Functions (supabase/functions)

- `*/index.ts` → Edge Function handlers
- Naming: `create-return-intent`, `resolve-dispute`, `track-returns`, etc.

---

### Git Hooks

- Husky for pre-commit hooks
- lint-staged runs Prettier and ESLint on staged files
- Automatic formatting on commit

---

### Database Schema

**Core Tables:**

- `products` - Items with status ('PENDING_VERIFICATION', 'IN_REVIEW', 'VERIFIED', 'SOLD', 'REJECTED', 'HIDDEN')
- `orders` - Purchase orders with status tracking. `completed_at`, `shipped_at` timestamps.
- `order_items` - Individual items in orders. `shipment_id` FK to shipments.
- `profiles` - Public user profile (name, avatar, bio, verification badge only)
- `profiles_private` - Sensitive data (email, role, phone, stripe_customer_id). Zero Trust: read-only via Edge Functions (service_role), frontend never writes directly.
- `shipments` - Per-seller shipment within an order. Tracks status, carrier, tracking, Envia ID, origin address, return tracking.
- `wallets` - User balances (available_balance, pending_balance)
- `wallet_transactions` - Financial ledger. `shipment_id` FK for multi-seller audit.
- `addresses` - User shipping info with `is_default` flag
- `notifications` - In-app alerts with `read`, `type`, `action_path`

**Order Status Flow (via `shipments` trigger):**

```
order.shipments → fn_derive_order_status() → order.status
Priority matrix:
  1. Exceptions: dispute > refunded > cancelled
  2. Progress (least advanced): paid > preparing > shipped > delivered
  3. All completed → completed
```

**Auth:**

- Roles live in `profiles_private.role`, NOT in JWT Custom Claims (DB source of truth)
- `is_admin()` STABLE function reads from `profiles_private`, SECURITY DEFINER, executable by PUBLIC
- Auth trigger functions write to `profiles_private` on user creation/update

**Dispute System:**

- `disputes` - Dispute cases with status, evidence, resolution. `shipment_id` FK.
- `locked_by`, `locked_at` - Soft-lock columns to prevent concurrent admin editing
- `return_tracking_number`, `return_label_url` - Return logistics tracking
- `return_payout_id`, `return_payout_status` - Return shipping payment tracking

**Admin System:**

- `admin_user_notes` - Internal notes per user
- `admin_audit_logs` - Audit trail for admin actions
- `seller_trust_stats` - Pre-computed seller statistics (view)

**Admin Views:**

- `admin_user_directory_view` - User list with wallet + stats joined
- `admin_disputes_monitor_view` - Disputes list for admin dashboard
- `admin_product_queue_view` - Products pending verification

### Soft-Lock Pattern

For preventing concurrent admin editing of products/disputes:

```sql
-- Lock acquisition (10 min expiry)
fn_lock_product(p_product_id, p_admin_id)
fn_lock_dispute(p_dispute_id, p_admin_id)

-- Lock release
fn_unlock_product(p_product_id, p_admin_id)
fn_unlock_dispute(p_dispute_id, p_admin_id)
```

### Dispute Resolution Flow

1. **Admin decides buyer wins** → Status: `waiting_return` → Seller pays return shipping
2. **Buyer submits return evidence** → Seller generate de shiping label → Status: `return_shipped`
3. **Track-returns cron** → Detects delivery → Status: `return_delivered`
4. **Admin triggers refund** → Stripe refund + wallet update (per shipment)

---

### Key Edge Functions

| Function                 | Purpose                                                 |
| ------------------------ | ------------------------------------------------------- |
| `create-payment-intent`  | Dual client: anon for customer + service_role for admin |
| `stripe-webhooks`        | Handle Stripe payment events                            |
| `resolve-dispute`        | Admin verdict (seller/buyer wins)                       |
| `resolve-dispute-refund` | Admin triggers refund per shipment                      |
| `create-return-intent`   | Seller pays return shipping via Stripe                  |
| `generate-return-label`  | Generate return shipping label. Sellers always pay      |
| `track-shipments`        | Cron: Track outgoing shipments                          |
| `track-returns`          | Cron: Track return packages                             |
| `manage-payment-methods` | Payment method management                               |

---

## Environment Setup

- Use Bun as runtime and package manager
- Configure `.env` with required variables:
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - `ENVIA_API_KEY_SANDBOX`, `ENVIA_API_KEY_PROD`, `ENVIA_MODE`
- Expo CLI for mobile development
- EAS CLI for builds and deployments
