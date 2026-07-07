# Proposal: Connect Onboarding Status Sync

## Intent

Sellers complete Stripe Connect onboarding successfully, but Selene's DB and admin dashboard remain stuck at `pending`. Two root causes: (1) `return_url`/`refresh_url` in `create-connect-account` point to `https://selene.app/seller/onboarding` — a web URL the mobile app never intercepts, causing a 404 on return; (2) no active reconciliation exists — the app only polls `profiles_private` and relies entirely on the `account.updated` webhook, so if a webhook is delayed, dropped, or pre-dates the handler, the status stays stale indefinitely.

## Scope

### In Scope
- Fix `return_url`/`refresh_url` to use `selene://` deep links with web fallback
- Add Android intent filter for `selene://sell/*` in `app.json`
- New edge function `refresh-connect-account-status` with server-side 60s throttle
- Schema migration: add `stripe_onboarding_refreshed_at timestamptz` to `profiles_private`
- Frontend hook calls reconciliation on screen focus, app-state resume, and browser-dismiss
- Admin "Refresh from Stripe" button per seller row
- Unit tests for new edge function, webhook handler, and URL generation

### Out of Scope
- Full Payments/Profile onboarding module redesign
- Broad admin audit or bulk-refresh of all pending sellers
- Checkout money flow or Transfer Reversal/Account Debit behavior
- Caching `requirements.currently_due` in DB (deferred — optional future enhancement)
- Web (PWA) onboarding path — mobile-only deep links for this slice

## Capabilities

### New Capabilities
- `connect-onboarding-sync`: Active reconciliation of Stripe Connect account status — edge function with throttle, deep-link return handling, frontend focus-based refresh, and admin per-seller refresh

### Modified Capabilities
None

## Approach

**Webhook stays as primary async updater.** The new `refresh-connect-account-status` edge function is the active recovery path:

1. **Throttle**: Check `stripe_onboarding_refreshed_at`; if < 60s ago and `force !== true`, return cached DB state. Prevents Stripe API spam.
2. **Auth**: Seller retrieves own account only (`auth.uid() === user_id`). Admin retrieves any account (`is_admin()` check via `profiles_private.role`). All DB writes use `service_role`.
3. **Retrieve**: Call `stripe.accounts.retrieve(accountId)`, recompute status with same logic as webhook (`charges_enabled && payouts_enabled` → `complete`, `disabled_reason` → `rejected`).
4. **Persist**: Update `profiles_private.stripe_onboarding_status` + set `stripe_onboarding_refreshed_at = now()`.
5. **Frontend triggers**: `useFocusEffect`, `AppState` → `active`, `WebBrowser.dismiss` event. Keep 10s polling as fallback.
6. **Deep links**: `selene://sell/onboarding?return=1` for mobile; `https://selene.app/seller/onboarding?return=1` as web fallback.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/functions/refresh-connect-account-status/` | New | Reconciliation edge function with throttle |
| `supabase/functions/create-connect-account/index.ts` | Modified | Fix `return_url`/`refresh_url` to deep links |
| `supabase/functions/stripe-webhooks/index.ts` | Modified | Normalize v1/v2 account shape (defensive) |
| `supabase/migrations/` | New | Add `stripe_onboarding_refreshed_at` column |
| `apps/frontend/core/hooks/useConnectOnboarding.ts` | Modified | Call refresh on focus/resume/dismiss |
| `apps/frontend/app/sell/onboarding.tsx` | Modified | Handle deep-link return params |
| `apps/frontend/app.json` | Modified | Add `sell/*` intent filter |
| `apps/admin-web/src/pages/SellerOnboardingPage.tsx` | Modified | Per-row "Refresh from Stripe" button |
| `packages/types/src/database.types.ts` | Modified | New column in generated types |
| `packages/types/src/index.ts` | Modified | Register new edge function |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| iOS SFViewController may not trigger `selene://` on redirect | Med | Use `expo-linking` listener + `WebBrowser.maybeCompleteAuthSession` fallback |
| Stripe API rate limits if throttle bypassed | Low | Server-side 60s check in edge function; client cannot bypass |
| v1/v2 account shape drift in webhook | Med | Defensive normalization in both webhook and refresh function |
| Deep-link intent filter conflicts with existing `auth-verified` | Low | Separate host entries in `app.json`; no overlap |

## Rollback Plan

1. Revert edge function deployment (`refresh-connect-account-status` — disable via Supabase dashboard).
2. Revert `create-connect-account` URL changes — restore hardcoded `https://selene.app` URLs.
3. Drop column: `ALTER TABLE profiles_private DROP COLUMN stripe_onboarding_refreshed_at;` — nullable additive column, zero data loss.
4. Frontend reverts to polling-only behavior (existing code path still works).

## Dependencies

- Stripe API: `stripe.accounts.retrieve()` (v1 stable)
- `expo-web-browser`: `openBrowserAsync` + `maybeCompleteAuthSession`
- `expo-linking`: deep-link event listener

## Success Criteria

- [ ] Seller returns from Stripe onboarding → app shows correct status within 5 seconds
- [ ] No 404 on return from Stripe (deep link intercepted)
- [ ] Throttle prevents >1 Stripe API call per 60s per seller
- [ ] Admin can force-refresh any seller's status from dashboard
- [ ] Webhook remains primary updater; reconciliation is recovery-only
- [ ] All new/modified edge functions have unit tests (`bun test`)
