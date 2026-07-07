# Tasks: Connect Onboarding Status Sync

## Review Workload Forecast

| Field                   | Value                                                     |
| ----------------------- | --------------------------------------------------------- |
| Estimated changed lines | ~460                                                      |
| 400-line budget risk    | Medium                                                    |
| Chained PRs recommended | Yes                                                       |
| Suggested split         | PR 1 (Foundation) → PR 2 (Core) → PR 3 (Frontend + Admin) |
| Delivery strategy       | ask-on-risk                                               |
| Chain strategy          | pending                                                   |

```
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Medium
```

### Suggested Work Units

| Unit | Goal                                                             | Likely PR | Notes                                                              |
| ---- | ---------------------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| 1    | Migration + types + shared helper + helper tests                 | PR 1      | Base: `main`. Zero-downtime additive. Tests with code.             |
| 2    | Refresh edge function + webhook hardening + URL deep-links       | PR 2      | Base: `main`. Depends on shared helper from PR 1. Tests with code. |
| 3    | Frontend hook/screen + deep-link handling + admin refresh button | PR 3      | Base: `main`. Depends on edge function from PR 2.                  |

### PR Boundaries

- **PR 1**: No runtime dependency — migration is additive, shared helper is pure, types are regenerated. Deployable alone.
- **PR 2**: Imports `_shared/connect-status.ts` from PR 1. Edge function deploys, webhook is updated, create-connect-account URLs change. Each function has its own test.
- **PR 3**: Frontend calls `refresh-connect-account-status` which only exists after PR 2. Admin page mutation calls same function.

## Phase 1: Foundation

- [x] 1.1 Create migration `20260615100000_add_onboarding_refreshed_at.sql`: `ALTER TABLE profiles_private ADD COLUMN IF NOT EXISTS stripe_onboarding_refreshed_at TIMESTAMPTZ`
- [x] 1.2 Run `bun db:types` to regenerate `packages/types/src/database.types.ts` with new column
- [x] 1.3 Register `refresh-connect-account-status` in `packages/types/src/index.ts` `EdgeFunctionRegistry`:
      `payload: { force?: boolean; sellerId?: string }`, `response: { status, accountId, chargesEnabled, payoutsEnabled, refreshedAt, cached }`
- [x] 1.4 Create `supabase/functions/_shared/connect-status.ts` with `normalizeAccountStatus(account)`: maps v1/v2 shape to `{ status, chargesEnabled, payoutsEnabled }`. Logic: `charges_enabled && payouts_enabled` → `complete`; `disabled_reason` and not `requirements.past_due` → `rejected`; else `pending`.
- [x] 1.5 Add `normalizeAccountStatus` unit tests: v1 shape, v2 shape, missing fields, `disabled_reason` variants, boundary cases.

## Phase 2: Core Reconciliation

- [x] 2.1 Create `supabase/functions/refresh-connect-account-status/index.ts`: seller auth (own ID) or admin (DB role check), 60s throttle on `stripe_onboarding_refreshed_at`, `stripe.accounts.retrieve(accountId)`, `normalizeAccountStatus()`, UPDATE with both status + `refreshed_at = now()`, `force: true` bypasses throttle. Return full response object.
- [x] 2.2 Modify `supabase/functions/create-connect-account/index.ts`: replace hardcoded `https://selene.app/seller/onboarding` defaults with `Linking.createURL('/sell/onboarding')`-style URLs (accept client-provided, fallback to env-based defaults).
- [x] 2.3 Modify `supabase/functions/stripe-webhooks/index.ts`: import `normalizeAccountStatus()` from `_shared/connect-status.ts` replacing inline status logic; also set `stripe_onboarding_refreshed_at = now()` on `account.updated` handler.
- [x] 2.4 Add `refresh-connect-account-status` unit tests: throttle hit/miss, force bypass, seller-vs-admin auth, cross-seller 403, status transitions (pending→complete, pending→rejected), Stripe API failure returns cached status with error flag.

## Phase 3: Frontend & Admin Integration

- [x] 3.1 Modify `apps/frontend/app.json`: add Android intent filter for `selene://sell/*` (host: `sell`), keep existing `auth-verified` filter.
- [x] 3.2 Modify `apps/frontend/core/hooks/useConnectOnboarding.ts`: add `refreshFromStripe()` calling `invokeEdge('refresh-connect-account-status', { force: false })`; remove 3s polling; wire `useFocusEffect`, `AppState` → `active`, `WebBrowser.dismissBrowser` to invoke refresh; invalidate query on response.
- [x] 3.3 Modify `apps/frontend/app/sell/onboarding.tsx`: read `return` param via `useLocalSearchParams`; show "Checking..." state during refresh on return from Stripe; show error flag from stale cache fallback.
- [x] 3.4 Modify `apps/admin-web/src/hooks/useSellerOnboarding.ts`: add `refreshSeller(sellerId)` mutation calling `invokeEdge('refresh-connect-account-status', { sellerId, force: true })`, invalidate `['seller-onboarding']` query on success.
- [x] 3.5 Modify `apps/admin-web/src/pages/SellerOnboardingPage.tsx`: add per-row "Refresh from Stripe" button (icon + spinner) calling `refreshSeller(seller.id)`, disabled while loading.

## Phase 4: Verification

- [x] 4.1 Verify `normalizeAccountStatus()` tests pass: all v1/v2 shape variants, disabled_reason edge cases.
- [x] 4.2 Verify `refresh-connect-account-status` tests pass: throttle, auth, force bypass, error handling.
- [x] 4.3 Verify webhook `account.updated` still works end-to-end: webhook payload → status update + `refreshed_at` set.
- [x] 4.4 Manual E2E: Stripe test-mode onboarding → deep-link return → app shows `complete` within 5s.
- [x] 4.5 Confirm admin "Refresh from Stripe" returns updated status and UI reflects change.

## Phase 5: Stripe AccountLink URL Bugfix

- [x] 5.1 Add HTTPS `connect-onboarding-return` Edge Function bridge for Stripe AccountLink return/refresh URLs; bridge redirects to app deep links with safe defaults and future production URL env override.
- [x] 5.2 Update `create-connect-account` URL resolver so Stripe only receives HTTPS URLs: accept client HTTPS URLs, otherwise use configured/deployed HTTPS bridge; never pass raw `selene://...` to AccountLinks.
- [x] 5.3 Add targeted helper tests covering HTTPS client URLs, deep-link-to-bridge conversion, local HTTPS tunnel override, production URL override, safe failure, and bridge redirect states.
- [x] 5.4 Deploy `connect-onboarding-return` and `create-connect-account`, then rerun Stripe test-mode onboarding against a fresh/alternate seller account.
