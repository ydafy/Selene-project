# Design: Connect Onboarding Status Sync

## Technical Approach

Active reconciliation layer on top of the existing webhook-primary flow. A new `refresh-connect-account-status` edge function calls Stripe directly with a server-side 60s throttle, wired into the frontend via focus/resume/dismiss triggers. Deep-link URLs replace hardcoded `https://selene.app` paths. A shared normalization helper unifies v1/v2 account status logic across webhook and refresh function.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Throttle storage | Redis / in-memory / DB column | Redis adds infra; in-memory lost on cold start | `profiles_private.stripe_onboarding_refreshed_at` — single nullable column, zero new infra |
| Deep-link strategy | Universal links only / scheme only / scheme + web fallback | Universal links need server config; scheme-only breaks web | `selene://` scheme built via `Linking.createURL()` at runtime, passed to `create-connect-account` via existing `returnUrl`/`refreshUrl` payload fields |
| Polling after fix | Keep 3s / remove / replace with focus-only | 3s polling is noisy and unnecessary with server-throttled focus refresh | Remove polling; use `useFocusEffect` + `AppState` + `WebBrowser.dismiss` (all hit throttled endpoint — safe to fire freely) |
| v1/v2 normalization | Inline per-call / shared helper | Inline duplicates logic; helper is testable in isolation | Extract `normalizeAccountStatus()` into `supabase/functions/_shared/connect-status.ts` |
| Admin refresh auth | Separate endpoint / same endpoint with role check | Separate endpoint duplicates logic | Same `refresh-connect-account-status` — admin bypasses throttle via `force: true` |

## Data Flow

```
Seller returns from Stripe
    │
    ▼
selene://sell/onboarding?return=1  ──→  Expo Linking listener
    │                                        │
    ▼                                        ▼
onboarding.tsx focus event  ──→  useConnectOnboarding.refresh()
                                       │
                                       ▼
                        invokeEdge('refresh-connect-account-status', { force: false })
                                       │
                    ┌──────────────────┴──────────────────┐
                    │  Check refreshed_at < 60s?          │
                    │  YES → return cached DB status      │
                    │  NO  → stripe.accounts.retrieve()   │
                    │        normalizeAccountStatus()      │
                    │        UPDATE profiles_private       │
                    └──────────────────┬──────────────────┘
                                       │
                                       ▼
                        TanStack Query invalidates
                        → UI shows updated status
```

Webhook path (unchanged, primary):
```
Stripe → account.updated → stripe-webhooks → normalizeAccountStatus()
         → UPDATE profiles_private (status + refreshed_at)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/_shared/connect-status.ts` | Create | Shared `normalizeAccountStatus()` helper — v1/v2 defensive field access |
| `supabase/functions/refresh-connect-account-status/index.ts` | Create | Reconciliation edge function with 60s throttle |
| `supabase/functions/refresh-connect-account-status/refresh-connect-account-status.test.ts` | Create | Unit tests: throttle, force, auth, status transitions |
| `supabase/functions/create-connect-account/index.ts` | Modify | Remove hardcoded URLs; use client-provided URLs or env-based defaults |
| `supabase/functions/stripe-webhooks/index.ts` | Modify | Use shared `normalizeAccountStatus()`; also set `refreshed_at = now()` |
| `supabase/migrations/20260615100000_add_onboarding_refreshed_at.sql` | Create | `ALTER TABLE profiles_private ADD COLUMN IF NOT EXISTS stripe_onboarding_refreshed_at TIMESTAMPTZ` |
| `apps/frontend/core/hooks/useConnectOnboarding.ts` | Modify | Add `refreshFromStripe()` calling edge function; remove 3s polling; wire focus/resume/dismiss |
| `apps/frontend/app/sell/onboarding.tsx` | Modify | Handle deep-link return params via `useLocalSearchParams`; show "Checking..." state |
| `apps/frontend/app.json` | Modify | Add `sell/*` intent filter for Android |
| `apps/admin-web/src/pages/SellerOnboardingPage.tsx` | Modify | Per-row "Refresh from Stripe" button calling edge function with admin auth |
| `apps/admin-web/src/hooks/useSellerOnboarding.ts` | Modify | Add `refreshSeller(sellerId)` mutation |
| `packages/types/src/index.ts` | Modify | Register `refresh-connect-account-status` in `EdgeFunctionRegistry` |
| `packages/types/src/database.types.ts` | Modify | Regenerated via `bun db:types` after migration |

## Interfaces / Contracts

**Edge Function Request/Response:**
```typescript
// EdgeFunctionRegistry entry
'refresh-connect-account-status': {
  payload: { force?: boolean; sellerId?: string };
  response: {
    status: 'pending' | 'complete' | 'rejected';
    accountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    refreshedAt: string;
    cached: boolean; // true if throttle returned DB value
  };
};
```

**Shared normalization helper:**
```typescript
// supabase/functions/_shared/connect-status.ts
export function normalizeAccountStatus(account: {
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  requirements?: { disabled_reason?: string | null };
}): { status: 'pending' | 'complete' | 'rejected'; chargesEnabled: boolean; payoutsEnabled: boolean }
```

**Deep-link URL construction (frontend):**
```typescript
import * as Linking from 'expo-linking';
const returnUrl = Linking.createURL('/sell/onboarding', { queryParams: { return: '1' } });
// Native: selene://sell/onboarding?return=1
// Dev web: http://localhost:8081/sell/onboarding?return=1
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `normalizeAccountStatus()` — v1 shape, v2 shape, missing fields, disabled_reason variants | `bun:test` pure function tests |
| Unit | `refresh-connect-account-status` — throttle hit/miss, force bypass, seller-vs-admin auth, status transitions | Mock Stripe SDK + Supabase client |
| Unit | `create-connect-account` URL generation — client-provided URLs used, defaults fallback | Mock request object |
| Unit | `stripe-webhooks` account.updated — v1/v2 payloads, DB update correctness | Mock event objects |
| Integration | `useConnectOnboarding` — focus triggers refresh, polling removed, error states | Mock `invokeEdge`, assert query invalidation |
| E2E (manual) | Complete Stripe test-mode onboarding → app shows `complete` within 5s | Stripe test mode + dev client |

## Migration / Rollout

1. **Migration** (additive, zero-downtime):
   ```sql
   ALTER TABLE public.profiles_private
     ADD COLUMN IF NOT EXISTS stripe_onboarding_refreshed_at TIMESTAMPTZ;
   ```
2. **Deploy** `refresh-connect-account-status` edge function.
3. **Deploy** updated `create-connect-account` (URL fix) and `stripe-webhooks` (shared helper).
4. **Deploy** frontend with deep-link handling and focus-based refresh.
5. **Regenerate** types: `bun db:types`.
6. **Rollback**: revert edge function, restore hardcoded URLs, drop column (nullable — zero data loss).

No feature flag needed — the throttle column is additive and the old polling path is replaced atomically in the frontend deploy.

## Open Questions

- [ ] Should admin force-refresh bypass the 60s throttle unconditionally, or should there be a shorter admin throttle (e.g. 10s)?
- [ ] Do we need iOS associated domains config for `selene://` scheme, or does Expo's `scheme: "selene"` in `app.json` suffice for SFViewController redirect interception?
