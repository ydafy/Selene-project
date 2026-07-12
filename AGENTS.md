# Repository Guidelines

## Project Snapshot

Selene is a Mexican peer-to-peer marketplace for used PC hardware, focused on trust and technical verification.

```text
apps/frontend/       Expo React Native app
apps/admin-web/      React + Vite admin dashboard
apps/backend/        Express API (limited use)
packages/types/      Shared TypeScript and generated Supabase types
supabase/functions/  Supabase Edge Functions
supabase/migrations/ Database migrations
supabase/queries/    Canonical SQL source copies and operational queries
openspec/            Product and technical contracts
```

Core stack: Bun, strict TypeScript, Expo Router, Zustand, TanStack Query, Shopify Restyle, Tailwind CSS, Supabase/Postgres, Stripe Connect, and Envia.com.

## Sources of Truth

Use the narrowest authoritative source instead of guessing:

1. Current product behavior: `openspec/specs/`
2. Active change intent: `openspec/changes/<change>/`
3. Database schema and relationships: `packages/types/src/database.types.ts`
4. Shared DB aliases: `packages/types/src/index.ts`
5. Project skills: `.atl/skill-registry.md`
6. Executable behavior: current implementation and tests

Archived OpenSpec changes explain history, not necessarily current behavior.

## Working Rules

Before modifying code:

1. Read related contracts, implementation, and tests.
2. Reuse existing patterns before introducing abstractions.
3. Prefer the smallest complete change that preserves established invariants.
4. Keep technical artifacts, code, identifiers, comments, tests, and UI copy in English unless the existing target context clearly uses another language.
5. Add JSDoc only for public APIs or non-obvious invariants.

### Scope Discipline

- Do not modify files outside the requested change because they look improvable.
- Do not fix unrelated warnings, formatting, generated files, or baseline failures opportunistically.
- Never modify ESLint, TypeScript, formatter, test-runner, build, Git hook, or CI configuration merely to make a feature pass. Configuration changes require explicit scope or maintainer approval.
- When unrelated failures block verification, report the exact command and evidence, then stop for a decision.
- Preserve unrelated worktree changes. Never discard or overwrite them.

## Supabase Deployment Workflow (MANDATORY)

Files under `supabase/` are deployment sources. Their presence in the repository does **not** prove the remote Supabase project contains those changes.

The maintainer deploys Supabase changes manually through the Supabase Dashboard. Agents must:

1. Create or update the required migration/query/function files in the repository.
2. Stop before remote synchronization and report:
   - exact SQL file(s) to execute;
   - execution order;
   - affected Edge Functions to deploy;
   - required secrets, cron, webhook, or Dashboard configuration;
   - post-deployment verification steps.
3. Wait for maintainer confirmation that SQL was applied remotely.
4. Run `bun db:types` only after that confirmation.
5. Verify generated types contain the expected schema changes before continuing.
6. Treat SQL, Edge Function deployment, secrets, cron jobs, webhooks, and generated types as separate deployment steps.

Do not apply remote migrations, deploy Edge Functions, change secrets, or configure cron/webhooks unless the maintainer explicitly requests it.

### Type First (MANDATORY)

Before code reads or writes database data:

1. Read `packages/types/src/database.types.ts`.
2. Read `packages/types/src/index.ts`.
3. Use exported aliases such as `Tables<'orders'>` and `Enums<'order_status_enum'>`.
4. Never guess table, column, enum, or relationship names.

For a new schema change, the migration defines the intended future schema. Existing generated types remain authoritative for the deployed schema until the maintainer applies SQL and regenerates them.

## Financial and Security Invariants

- Store and calculate money in integer cents at application boundaries. Convert to decimal currency only for database/display contracts that require it.
- Orders are multi-seller; `shipments` are the seller-scoped fulfillment, cancellation, dispute, payout, and audit boundary.
- Never release, refund, cancel, or transfer money using client-provided amounts without server-side reconstruction and validation.
- Stripe refunds must succeed before the corresponding database cancellation is committed.
- Stripe processing fees are not assumed from estimates after payment; Stripe transaction data is authoritative for actual fees.
- Privileged financial mutations belong in Edge Functions using server credentials and narrowly granted database RPCs.
- Never expose `SUPABASE_SERVICE_ROLE_KEY`, Stripe secret keys, Envia keys, or webhook secrets to clients or logs.
- Roles live in `profiles_private.role`, not JWT custom claims. Frontends never write directly to `profiles_private`.
- Preserve RLS and explicit authorization boundaries. `SECURITY DEFINER` functions require explicit privilege review and revoked `PUBLIC` execution unless public access is intentional.
- External callbacks and cron handlers must be authenticated, idempotent, retry-safe, and observable.

## Folder Boundaries

### Mobile (`apps/frontend`)

- `app/`: Expo Router screens and navigation
- `components/ui/`: generic reusable UI
- `components/features/`: feature-specific UI
- `core/hooks/`: hooks
- `core/store/`: Zustand stores
- `core/`: domain utilities, clients, theme, auth, and i18n

### Admin (`apps/admin-web/src`)

- `pages/`: routed pages
- `components/ui/`: generic UI
- `components/features/`: feature-specific UI
- `hooks/`: TanStack Query and reusable hooks
- `lib/`: clients and utilities
- `store/`: Zustand stores

### Supabase (`supabase/functions`)

- Each deployable Edge Function uses `<function-name>/index.ts`.
- Cross-function pure helpers belong in `_shared/`.
- Keep service-role operations server-only.

## Skills

`.atl/skill-registry.md` is the only project skill index. Resolve and load matching skills before work. Do not duplicate the registry in this file.

Refresh after installing or updating skills:

```bash
gentle-ai skill-registry refresh --force
```

## Verification

Use Bun unless a package explicitly requires another tool.

```bash
bun test
bun run lint
bun db:types
```

- Start with focused tests, then run the relevant broader suite.
- Follow strict TDD when the active OpenSpec configuration enables it.
- Distinguish change-caused failures from verified baseline failures.
- Do not weaken tests or tooling to obtain a green result.
- A Supabase change is incomplete until repository artifacts, remote deployment, generated types, and focused verification agree.

## Git

- Husky and lint-staged run on commit.
- Keep commits scoped and reviewable; code, tests, migration, and relevant contract updates belong together.
- Never commit, push, deploy, or create a PR unless explicitly requested.
- Never add AI attribution or `Co-Authored-By` metadata.
