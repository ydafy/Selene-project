## Exploration: security-hardening

### Current State

- **`products` table** has RLS enabled with 6 policies (public select, owner select, admin select, owner update, admin update, delete block). Added in migration `20260608000000_product_deletion_hardening.sql`.
- **All other user-facing tables** in the `public` schema have **no RLS policies** and RLS is **not enabled**. This includes critical tables: `profiles_private`, `wallets`, `wallet_transactions`, `orders`, `order_items`, `shipments`, `payment_methods`, `payout_requests`, `seller_bank_accounts`, `addresses`, `profiles`, `disputes`, `reviews`, `reports`, `favorites`, `notifications`, `blocked_users`, `category_configurations`, `mexico_banks`, `mexico_zips`, `admin_audit_logs`, `admin_user_notes`.
- **Storage buckets** (`Avatars`, `evidence`, `products`, `verification`) are referenced in frontend/admin code but have **no bucket policies** defined in migrations.
- **Frontend protected route**: `apps/frontend/core/hooks/useProtectedRoute.ts` redirect logic is commented out on line 23 (`//router.replace('/(auth)');`), and the hook is **not imported anywhere** in the app. Unauthenticated users can navigate to protected screens.
- **Admin-web protected routes**: `App.tsx` has a working `ProtectedRoute` component that checks `profile?.role !== 'admin'`.
- **Edge Functions CORS**: Every inspected function sets `Access-Control-Allow-Origin: '*'`. No function restricts origin.
- **Edge Functions Rate Limiting**: None present in any function.
- **Edge Functions Zod validation**:
  - **Present**: `create-payment-intent`, `cancel-order`, `create-dispute`, `resolve-dispute`, `manage-payment-methods`, `get-shipping-quote`, `generate-shipping-label`.
  - **Missing**: `delete-account`, `release-funds`, `track-shipments`, `track-returns`, `auto-cancel-preparing`, `auto-cancel-orders`, `return-delivery-timeout`.

### Affected Areas

- `supabase/migrations/` — new RLS policies for all user-facing tables; storage bucket policies
- `apps/frontend/core/hooks/useProtectedRoute.ts` — restore redirect logic
- `apps/frontend/app/_layout.tsx` or `RootStack` — wire up auth guard if needed
- `supabase/functions/*/index.ts` — CORS hardening, rate limiting, Zod validation for non-excluded functions

### Approaches

1. **RLS: Table-by-table policy creation**
   - Pros: Granular, can test per table, matches Supabase best practices
   - Cons: Many migrations, risk of breaking existing direct frontend queries
   - Effort: Medium

2. **RLS: Bulk enable with generic `auth.uid()` policies first, then refine**
   - Pros: Faster coverage, reduces immediate exposure
   - Cons: May be too restrictive or permissive, requires follow-up tuning
   - Effort: Low-Medium

### Recommendation

- **First slice** (Blockers + Launch Requirements):
  1. Enable RLS on critical tables (`profiles_private`, `wallets`, `orders`, `shipments`, `payment_methods`, `addresses`, `profiles`, `notifications`) with `auth.uid()` ownership checks and admin overrides.
  2. Add storage bucket policies for `Avatars`, `evidence`, `products`, `verification`.
  3. Restore `useProtectedRoute.ts` redirect and wire it into `app/_layout.tsx` or `RootStack`.
  4. Add rate limiting middleware to user-facing Edge Functions (`create-payment-intent`, `cancel-order`, `delete-account`, `create-dispute`, `resolve-dispute`, `manage-payment-methods`, `get-shipping-quote`, `generate-shipping-label`).
  5. Restrict CORS to known origins (`selene.com.mx`, Expo dev origin, admin-web origin).
  6. Add Zod validation to `delete-account` (at minimum).
- **Second slice** (Hardening):
  - RLS on remaining tables (`reviews`, `reports`, `favorites`, `blocked_users`, `disputes`, `seller_bank_accounts`, `payout_requests`, `wallet_transactions`, `category_configurations`, reference tables).
- **Third slice** (Cleanup):
  - Zod validation on cron functions (HTTP method validation, minimal schemas).

### Risks

- **Breaking direct frontend queries**: Some frontend hooks query tables directly (e.g., `profiles_private` in `useConnectOnboarding.ts`, `payment_methods` in frontend). RLS must match these access patterns or they will break.
- **Admin dashboard breakage**: Admin-web queries views and tables directly; RLS on underlying tables must not block admin reads (use `is_admin()` or `TO service_role`).
- **Stripe Connect testing interference**: Must avoid modifying excluded functions currently under active testing.
- **Rate limiting dependency**: Needs Upstash Redis or Supabase pg-based solution — adds infra dependency.

### Ready for Proposal

Yes. The scope is clear: database RLS, storage policies, frontend auth guard, Edge Function hardening (CORS + rate limiting + Zod). Exclude Stripe Connect functions.

### Files Likely Touched Later

- `supabase/migrations/2026XXXXXX_security_rls.sql` (new)
- `supabase/migrations/2026XXXXXX_storage_policies.sql` (new)
- `apps/frontend/core/hooks/useProtectedRoute.ts`
- `apps/frontend/app/_layout.tsx`
- `supabase/functions/create-payment-intent/index.ts`
- `supabase/functions/cancel-order/index.ts`
- `supabase/functions/delete-account/index.ts`
- `supabase/functions/create-dispute/index.ts`
- `supabase/functions/resolve-dispute/index.ts`
- `supabase/functions/manage-payment-methods/index.ts`
- `supabase/functions/get-shipping-quote/index.ts`
- `supabase/functions/generate-shipping-label/index.ts`
