# Private Data Access Hardening — Future SDD Intent

## Goal

Audit and harden Supabase access for sensitive tables so frontend clients use minimum necessary permissions and data-shaped APIs, while RLS remains defense in depth.

## Trigger

During review of the Stripe onboarding UI, `useConnectOnboarding` was found reading `profiles_private` directly from the mobile client. A focused grants audit then showed broad `anon` and `authenticated` table privileges across sensitive tables.

## Initial Scope

- Review direct frontend reads from `profiles_private` and other sensitive tables.
- Replace direct private-table reads with Edge Functions, RPCs, or safe views where column exposure matters.
- Reduce public grants to the minimum needed by each role.
- Keep RLS policies as row-level protection, not the only access boundary.
- Verify admin-only tables are not exposed to non-admin roles beyond deliberate API surfaces.

## Candidate Tables

- `profiles_private`
- `orders`
- `order_items`
- `shipments`
- `disputes`
- `wallets`
- `wallet_transactions`
- `payment_methods`
- `seller_bank_accounts`
- `addresses`
- `payout_requests`
- `admin_user_notes`
- `admin_audit_logs`

## Evidence to Reuse

- `supabase/queries/rls/sensitive_access_audit.json`
- `supabase/queries/rls/grants_profiles_private.json`
- `supabase/queries/rls/index.json`

## Non-Goals for Current Stripe Onboarding UI Cycle

- Do not fix all grants/RLS in the onboarding UI commit.
- Do not mix broad security migrations with UX/copy/lint cleanup.
- Only touch `useConnectOnboarding` in the current cycle if needed to remove direct private-table access from the onboarding flow.

## Suggested Next SDD Phase


Start with exploration: map sensitive table usage from frontend/admin/Edge Functions, then classify each direct read as safe, needs column-limited API, or admin/service-only.
