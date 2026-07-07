# Exploration: connect-onboarding-status-sync

## 1. Current State

Selene's Stripe Connect onboarding flow (delta spec CON-001) is already implemented but has a **status synchronization gap** between Stripe and the Selene app/admin dashboard:

- **Frontend**: `apps/frontend/app/sell/onboarding.tsx` uses `useConnectOnboarding` to show status and launch Stripe-hosted onboarding via `expo-web-browser`.
- **Edge Function**: `create-connect-account` creates a Stripe Connect account (v2 with v1 fallback), persists `stripe_account_id` + `stripe_onboarding_status = 'pending'`, and returns an `AccountLink` URL.
- **Webhook**: `stripe-webhooks/index.ts` handles `account.updated`, mapping `charges_enabled && payouts_enabled` → `complete`, and `disabled_reason` (not `requirements.past_due`) → `rejected`.
- **Admin**: `get-seller-onboarding` edge function + `admin_seller_onboarding_view` powers `SellerOnboardingPage.tsx`.
- **Status source of truth**: `profiles_private.stripe_onboarding_status` (enum: `pending`, `complete`, `rejected`).

**Observed bug**: Seller completes Stripe onboarding, Stripe dashboard shows active, but Selene shows `pending`. The Stripe return after final confirmation hits a 404 because `return_url` / `refresh_url` are hardcoded to `https://selene.app/seller/onboarding?return=1` / `?refresh=1` — a web URL that the mobile app does not intercept.

**No active reconciliation exists**: The frontend polls `profiles_private` every 3s while `pending`, but it never asks Stripe directly for the current account state. If the webhook is delayed, dropped, or the account was updated before the webhook was configured, the DB remains stale indefinitely.

**No throttle column**: `profiles_private` has no `stripe_onboarding_refreshed_at` or `requirements` cache, so any new refresh mechanism must either add a column or rely on in-memory state.

**No tests for onboarding**: `create-connect-account` and the `account.updated` webhook handler have zero test coverage.

## 2. Affected Areas

| File | Why affected |
|------|-------------|
| `apps/frontend/app/sell/onboarding.tsx` | Needs to handle deep-link return from Stripe and trigger status refresh on focus/return |
| `apps/frontend/core/hooks/useConnectOnboarding.ts` | Needs active reconciliation call; current polling-only is insufficient |
| `apps/frontend/app.json` | Deep-link intent filters only cover `auth-verified`; need `sell/onboarding` route |
| `supabase/functions/create-connect-account/index.ts` | `return_url` / `refresh_url` are hardcoded to `https://selene.app/seller/onboarding?...` — needs app-scheme URLs or universal links |
| `supabase/functions/stripe-webhooks/index.ts` | `account.updated` logic is correct but untested; edge cases (v1 vs v2 account shape) not handled |
| `supabase/functions/get-seller-onboarding/index.ts` | Admin view is read-only; admin has no force-refresh capability |
| `packages/types/src/database.types.ts` | Missing `stripe_onboarding_refreshed_at` (or similar) for throttle |
| `packages/types/src/index.ts` | Edge registry missing `refresh-connect-account-status` entry |
| `apps/admin-web/src/pages/SellerOnboardingPage.tsx` | Could expose a "Refresh from Stripe" action per seller |
| `apps/admin-web/src/hooks/useSellerOnboarding.ts` | Uses `refetchInterval: 30000` but only hits DB, not Stripe |

## 3. Root Cause Candidates

| # | Root Cause | Evidence | Likelihood |
|---|-----------|----------|------------|
| 1 | **Bad return_url / refresh_url** → 404 on return | `create-connect-account/index.ts` lines 91-93 hardcode `https://selene.app/seller/onboarding?return=1`. `app.json` scheme is `selene` but intent filter only covers `auth-verified`. | **High** |
| 2 | **Webhook delivery gap** → stale `pending` | `stripe-webhooks` handles `account.updated`, but no DLQ retry logic exists for this event type. If webhook fails, `profiles_private` never updates. | **High** |
| 3 | **No active reconciliation** → no recovery path | `useConnectOnboarding` only polls Supabase every 3s. No edge function calls Stripe to verify status. | **High** |
| 4 | **v1/v2 account shape mismatch** in webhook | `account.updated` handler casts `event.data.object as Stripe.Account`. v2 accounts may have different `requirements` / `capabilities` shape than v1. The code only checks `charges_enabled`, `payouts_enabled`, and `requirements.disabled_reason`. | **Medium** |
| 5 | **Admin view shows cached DB state** | `admin_seller_onboarding_view` pulls from `profiles_private`, not Stripe. Admin sees stale data same as seller. | **Medium** |

## 4. Approaches

### Approach A: Passive Fix (URLs + Polling Tweak)

- Fix `return_url` / `refresh_url` to use `selene://sell/onboarding?return=1` and add universal link / intent filter.
- Extend frontend polling interval from 3s to 10s to reduce noise.
- Add a manual "Refresh" button on the onboarding screen that just re-fetches Supabase.

- **Pros**: Minimal code, low risk.
- **Cons**: Does not solve webhook gaps, no throttle, admin still blind, no production-grade robustness.
- **Effort**: Low

### Approach B: Active Reconciliation with Throttle (Recommended)

1. **Schema**: Add `stripe_onboarding_refreshed_at timestamptz` to `profiles_private` (nullable, no default). Optional: add `stripe_onboarding_requirements jsonb` to cache Stripe's `requirements.currently_due` for richer UI.
2. **New Edge Function**: `refresh-connect-account-status`
   - Auth: seller (own account) or admin (any account).
   - Input: `{ force?: boolean }`.
   - Throttle: if `stripe_onboarding_refreshed_at` is within 60s and `force !== true`, return cached DB status without calling Stripe.
   - Call `stripe.accounts.retrieve(accountId)` (v1) or `stripe.v2.core.accounts.retrieve(accountId)` (v2).
   - Recompute status using same logic as webhook (`charges_enabled && payouts_enabled` → `complete`, etc.).
   - Update `profiles_private` + `stripe_onboarding_refreshed_at = now()`.
   - Return `{ status, accountId, chargesEnabled, payoutsEnabled, refreshedAt }`.
3. **Frontend**:
   - Update `useConnectOnboarding` to call `refresh-connect-account-status` on:
     - `useFocusEffect` (screen focus)
     - AppState change to `active` (return from background)
     - After `WebBrowser.openBrowserAsync` closes (seller returns from Stripe)
   - Keep polling as a fallback but reduce to 10s or remove if focus-based refresh is reliable.
   - UI: show "Checking with Stripe..." spinner during refresh; clear error states.
4. **Admin**:
   - Add "Refresh from Stripe" button per row in `SellerOnboardingPage.tsx`.
   - Call `refresh-connect-account-status` with admin auth.
5. **URL Fix**:
   - Change `create-connect-account` to use `return_url` / `refresh_url` based on request input or configured app URL.
   - Mobile: `selene://sell/onboarding?return=1`
   - Web fallback: `https://selene.app/seller/onboarding?return=1`
   - Ensure `app.json` Android intent filters and iOS universal links handle `selene://sell/*`.
6. **Testing**:
   - Add `bun:test` tests for `refresh-connect-account-status` covering throttle, force, status transitions, and admin vs seller auth.
   - Add tests for `create-connect-account` URL generation.
   - Add tests for `stripe-webhooks` `account.updated` handler.

- **Pros**: Solves all root causes, production-grade, rate-limited, admin-aware, recoverable from webhook failures.
- **Cons**: Requires new edge function, migration, schema update, and frontend focus-handling logic.
- **Effort**: Medium

### Approach C: Webhook-Only Hardening

- Fix webhook endpoint to add idempotency / DLQ retry for `account.updated`.
- Add a cron job that periodically re-syncs all `pending` accounts from Stripe.
- Keep frontend passive.

- **Pros**: No frontend changes needed.
- **Cons**: Cron is blunt (scans all pending accounts), delays still exist (cron interval), no immediate user feedback on return from Stripe, admin has no per-seller refresh.
- **Effort**: Medium

## 5. Recommendation

**Approach B** is the only production-grade solution. It addresses the immediate 404 (URL fix), closes the webhook reliability gap (active reconciliation), prevents API spam (server-side throttle), and gives admin visibility (per-row refresh). The 60-second throttle is conservative enough to avoid Stripe rate limits while feeling responsive.

**Minimal schema addition**:
```sql
ALTER TABLE public.profiles_private
  ADD COLUMN IF NOT EXISTS stripe_onboarding_refreshed_at TIMESTAMPTZ;
```

**No additional columns are strictly required** — the throttle can be implemented with just this one column. Caching `requirements` is optional and can be deferred.

## 6. Risks

- **Deep link reliability**: iOS in-app browsers (SFViewController) may not reliably trigger `selene://` links on redirect. A fallback using `expo-linking` `addEventListener` + `WebBrowser.maybeCompleteAuthSession` is needed.
- **Stripe API rate limits**: `refresh-connect-account-status` must enforce the 60s throttle server-side; a malicious client could otherwise spam Stripe.
- **v1/v2 account shape drift**: Stripe's `account.updated` payload shape differs between v1 and v2. The new edge function and webhook must both handle both shapes or we must normalize after account creation.
- **Admin auth edge case**: The admin refresh path must verify `role = 'admin'` in `profiles_private` (not JWT claims) per project security convention.
- **Migration rollback**: Adding `stripe_onboarding_refreshed_at` is additive and nullable — zero risk to existing data.

## 7. Security Notes

- `profiles_private` must remain writable only via `service_role` (edge functions). Never allow frontend to update `stripe_onboarding_status` directly.
- `refresh-connect-account-status` must use `service_role` for DB updates and must validate the caller's identity via `supabase.auth.getUser()` before checking ownership (seller) or role (admin).
- Do not expose `stripe_account_id` to other sellers via any API.
- The webhook `account.updated` handler already uses `stripe_account_id` as the lookup key, not `user.id`, which is correct because Stripe owns the account ID.

## 8. Testing Strategy

- **Unit**: `refresh-connect-account-status` — throttle logic, force flag, status transitions, auth rejection.
- **Unit**: `create-connect-account` — URL generation for mobile vs web, v1/v2 fallback.
- **Unit**: `stripe-webhooks` — mock `account.updated` events for v1 and v2, assert DB updates.
- **Integration**: Frontend `useConnectOnboarding` — mock `refresh-connect-account-status` return, assert focus-triggered refresh.
- **E2E** (manual): Complete onboarding in Stripe test mode, verify app status updates within seconds of return.

## 9. Ready for Proposal

**Yes.** The scope is clear, the root causes are identified, and the recommended approach is well-defined. The orchestrator can proceed to `sdd-propose` with the following summary for the user:

> "We found three issues: (1) the return URL from Stripe points to a web page the app doesn't handle, causing a 404; (2) the app only waits for webhooks to update status, so if a webhook is missed the status stays stale forever; (3) there's no way for a seller or admin to ask Stripe directly for the current status. We'll fix the URLs, add a new edge function that checks Stripe with a 60-second throttle, and wire it into the app so status updates immediately when the seller returns from Stripe."

## 10. Open Questions

1. Should the app support **web onboarding** (PWA/Expo web) in addition to native? If yes, `return_url` needs environment-based switching.
2. Should the admin dashboard allow **bulk refresh** of all pending sellers, or only per-row?
3. Should we cache `requirements.currently_due` in the DB to show the seller *which* KYC steps are still missing?
4. Is the Stripe Connect account always v2 now, or do we still need to support v1 accounts created before the SDK upgrade?
