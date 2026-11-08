# Auth

How identity, account states, sign-in, account closure, and CAPTCHA work today, and which object enforces each rule. This page is a map: it names files and functions instead of copying them. For Dashboard settings and the switch-on order, read [`docs/go-live.md`](go-live.md), section 10. For the decisions behind these rules, read [`odd/tasks/auth-hardening.md`](../odd/tasks/auth-hardening.md).

## Identity

Three tables describe a user. `auth.users` belongs to Supabase Auth. `profiles` holds the public part. `profiles_private` holds the trusted part.

- `profiles`: `username`, `avatar_url`, `is_verified_seller`, rating and sales counters, `deleted_at`. Everyone can read it. A user can update only their own `username`, `avatar_url`, and `updated_at`.
- `profiles_private`: `email`, `role` (`user` or `admin`), `status` (`account_status`: `active`, `suspended`, `banned`), `status_reason`, `phone_number`, and the Stripe ids. A user can read only their own row, and an admin can read every row. No client writes it.
- Roles live in `profiles_private.role`, never in JWT claims or Auth metadata. `is_admin()` reads that row and is true only for an `admin` whose status is `active`.

Inserting a row in `auth.users` fires the trigger `tr_on_auth_user_created`, which runs `fn_on_auth_user_created`. It creates the `profiles` row and the `profiles_private` row (role `user`, status `active`). It ignores `role` and `status` in signup metadata.

- A username typed at registration must be 3 to 20 characters and free. If not, signup fails with `check_violation` or `unique_violation`.
- A username derived from Google metadata or the email prefix goes through `fn_generate_profile_username`, which normalizes it and adds a suffix when needed.
- The trigger `tr_profiles_reserve_deleted_username` (`fn_reserve_deleted_username`) keeps the `deleted_` prefix for closed accounts.
- The trigger `on_auth_user_updated` runs `fn_on_auth_user_updated` only when the email changes, and the function mirrors the new email into `profiles_private.email`. A sign-in does not touch `profiles_private`.

The canonical SQL of the auth functions is in `supabase/queries/auth/` and `supabase/queries/admin/fn_admin_update_user_status.sql`.

## Account states

`account_status` has three values. A closed account is not a fourth value: it is `banned` with `status_reason = 'account_closed'` and `profiles.deleted_at` set.

| Action                        | active | suspended                     | banned                                   | closed         |
| ----------------------------- | ------ | ----------------------------- | ---------------------------------------- | -------------- |
| Sign in                       | yes    | yes, with a suspension notice | yes, but only the blocked-account screen | no             |
| Publish a listing             | yes    | no                            | no                                       | no             |
| Edit own listings             | yes    | no                            | no                                       | no             |
| Receive a sale or reservation | yes    | no                            | no                                       | no             |
| Buy                           | yes    | yes                           | no (`ACCOUNT_RESTRICTED`)                | no             |
| Close the account yourself    | yes    | no (`account_restricted`)     | no (`account_restricted`)                | already closed |

Notes on the table:

- Reading orders, submitting evidence, and fulfilling existing shipments and returns are not gated by status. Refunds and dispute resolution stay under admin and server control. A suspension does not cancel anything or move money.
- A banned user keeps a session so the app can show the blocked-account screen with the reason (`apps/frontend/src/shared/ui/system-guard.tsx`). The same component shows the suspension notice. The server gates are the ones in the table.
- A closed account cannot sign in because `fn_close_account` removes its credentials and identities and sets `auth.users.banned_until` far in the future.
- There is no seller-initiated payout request: `fn_request_payout` was dropped with the legacy wallet. An admin releases payouts through `release-connect-payout`, and that function does not look at the seller's account status.

### How a state changes

Only `fn_admin_update_user_status(p_target_user_id, p_admin_id, p_new_status, p_reason)` changes `profiles_private.status`.

- The actor is the JWT subject. The function ignores `p_admin_id`. The actor must pass `is_admin()`, so a suspended or banned admin has no authority (`UNAUTHORIZED_ADMIN_ONLY`).
- An admin cannot change their own status (`CANNOT_CHANGE_OWN_STATUS`). A `NULL` status is refused (`INVALID_ACCOUNT_STATUS`).
- `banned` is final. Any change away from it fails with `BANNED_IS_FINAL`. Only a same-status call refreshes the reason.
- Every change writes a `USER_STATUS_UPDATE` row in `admin_audit_logs`.
- Suspending or banning hides the seller's `VERIFIED`, `PENDING_VERIFICATION`, and `IN_REVIEW` listings and stores each prior status in `products.status_before_account_hold`.
- Lifting a suspension restores only the listings that carry that hold, each to its prior status, then clears the hold. Any other `HIDDEN` listing stays hidden.
- While the seller is suspended or banned, `fn_release_listings` holds a listing that would return to sale (an expired reservation, a refund, a cancelled shipment) as `HIDDEN` with the hold set. Lifting the suspension then restores it.

The admin UI is `apps/admin-web/src/components/features/verify/UserSafetyActions.tsx` with `apps/admin-web/src/components/features/verify/accountStatusActions.ts`.

## Who can do what

Clients are `anon` and `authenticated` with the anon key. Everything else runs in a trusted path.

- Client privileges are the least-privilege matrix in `supabase/migrations/20261101120000_auth_grants_least_privilege.sql`. In short: `anon` reads `profiles` and nothing else in the auth tables. `authenticated` reads `profiles_private` (RLS limits it to the own row, or all rows for an admin), updates the three profile columns, and reads `admin_audit_logs` (RLS limits it to admins) plus `admin_user_directory_view`, `admin_disputes_monitor_view`, and `admin_product_queue_view`. The other admin views have no client privilege. Nobody but `service_role` writes `profiles_private`.
- Row access is RLS. The policies that carry account rules are `products_insert` and `products_update_owner` (both call `fn_current_account_is_active()`), `profiles_update`, `profiles_private_access`, `admin_audit_logs_read`, and `admin_user_notes_all`.
- Edge Functions use `service_role` and check the caller themselves. Admin functions use `isActiveAdmin` from `supabase/functions/_shared/admin-auth.ts`, which applies the same rule as `is_admin()`.
- `SECURITY DEFINER` RPCs carry the privileged writes. `fn_admin_update_user_status` is executable by `authenticated` and checks the admin inside. `fn_close_account`, `fn_reserve_products`, and `fn_release_listings` are executable by `service_role` only.

## Sign-in, sessions, and recovery

Paths in this section and the next are relative to `apps/frontend` for the mobile app, `apps/admin-web/src` for the admin dashboard, and `supabase/functions` for Edge Functions.

- Email and password: sign-up with a 6-digit email code. The code lives in `apps/frontend/src/features/auth/hooks/use-auth.ts` (`signUp`, `signInWithPassword`, `verifyOtp`, `resend`), `apps/frontend/src/features/auth/components/register-form.tsx`, and `apps/frontend/src/app/(auth)/verify-code.tsx`. The auth screens open through `useAuthModal` (`apps/frontend/src/shared/lib/auth/auth-modal-context.ts`); `apps/frontend/src/features/auth/components/auth-modal-provider.tsx` mounts the modal. The server rules (confirmation on, minimum 8 characters, code length and expiry) mirror the Dashboard in `[auth]` of `supabase/config.toml`.
- Google: `apps/frontend/src/features/auth/hooks/use-google-auth.tsx` calls `signInWithIdToken`, and `apps/frontend/src/shared/lib/auth/google-auth.logic.ts` maps its errors. Supabase links a Google sign-in to an existing user with the same verified email. Manual linking stays off (`enable_manual_linking = false`).
- Password change: Settings asks for the current password and sends it as `current_password` (`apps/frontend/src/features/settings/logic/password-change.ts`, `apps/frontend/src/features/settings/components/security-section.tsx`). The Dashboard has "Require current password" on and "Secure password change" off. Google-only accounts are detected from their identities in `apps/frontend/src/shared/lib/auth/reauth.logic.ts`.
- Recovery: `apps/frontend/src/app/(auth)/forgotPassword.tsx` and `apps/frontend/src/app/(auth)/resetPassword.tsx` with `apps/frontend/src/features/auth/logic/password-recovery.logic.ts`. The email carries a 6-digit code. A recovery session does not need the current password. The email templates are in `supabase/templates/`.
- Email change: `apps/frontend/src/features/settings/logic/email-change.ts`. The user confirms from both inboxes through the link that opens `selene://profile/settings`.
- Mobile session: `apps/frontend/src/shared/lib/auth/use-session.ts` owns the listener, loads `status` and `status_reason` from `profiles_private`, and ignores late responses for a previous user (`apps/frontend/src/shared/lib/auth/session-status.logic.ts`). Sign-out has one path: `signOut(scope)` on the `AuthProvider` context (`apps/frontend/src/shared/lib/auth/auth-provider.tsx`, built by `apps/frontend/src/shared/lib/auth/create-sign-out.ts`). It unregisters the push token (raced against 4 s), calls Supabase, then runs the user-scoped resets, which also run on `SIGNED_OUT`. `apps/frontend/src/app/_layout.tsx` owns the reset list and passes it to `AuthProvider` (`apps/frontend/src/shared/` imports no feature): the React Query reset (keeping `system-settings`), checkout, cart, dispute, search history, product history, sell draft and review stores. Stores that persist to AsyncStorage (cart, dispute, search, product history) also call `persist.clearStorage()`, and `apps/frontend/src/shared/lib/auth/sign-out-resets.guard.test.ts` fails when a persisted store is missing; the experience store (device preferences) is kept on purpose. A reset that throws does not stop the rest, and a cleanup error never hides the Supabase error.
- Admin-web session: `apps/admin-web/src/store/useAuthStore.ts` with `apps/admin-web/src/lib/adminSession.logic.ts` and `apps/admin-web/src/lib/adminAccess.ts`. A user gets in only with role `admin` and status `active`. The page is `apps/admin-web/src/pages/Login.tsx`.

## Account closure

The product rule is "anonymize and close", not hard deletion. The flow is:

1. The app asks for a fresh sign-in (`apps/frontend/src/shared/lib/auth/reauth.ts`, `apps/frontend/src/features/settings/hooks/use-delete-account.ts`, `apps/frontend/src/features/settings/logic/delete-account-flow.ts`) and calls `delete-account` from `apps/frontend/src/features/settings/components/delete-account-section.tsx`.
2. `delete-account` validates the token, then requires a sign-in no older than 10 minutes (the newest `amr` timestamp; `MAX_SIGN_IN_AGE_SECONDS` in `supabase/functions/delete-account/handler.ts`). Older means `403 REAUTH_REQUIRED`.
3. It calls `fn_close_account(p_user_id)`, one SQL transaction. A blocker returns `409 DELETE_BLOCKED` with `blocked_reason`, and nothing changes.
4. After the commit, the function deletes the Stripe customer, closes the Connect account, and removes Storage files. It records each result in `account_closures`.
5. `account-closure-cleanup` retries failed steps every hour (the `0 * * * *` cron in `docs/go-live.md`). It authenticates with `x-cron-secret` (`supabase/functions/_shared/cron-auth.ts`) and gives up after 24 attempts per closure (`MAX_ATTEMPTS`). The shared steps are in `supabase/functions/_shared/account-closure-cleanup.ts`.

Blockers, in the order `fn_close_account` checks them:

| `blocked_reason`     | Meaning                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `account_restricted` | The account is suspended or banned. Its evidence stays.                                    |
| `active_shipments`   | A seller shipment or order item is unfinished, or a listing is `RESERVED` or `IN_DISPUTE`. |
| `active_orders`      | A buyer order is unfinished.                                                               |
| `open_disputes`      | A dispute is open for the user as buyer or seller.                                         |
| `pending_payouts`    | A completed shipment is not paid out yet, or a payout run needs reconciliation.            |
| `pending_refunds`    | A shipment cancellation refund or an order compensation is unsettled.                      |

When there is no blocker, `fn_close_account`:

- clears email, phone, and Stripe ids in `profiles_private`, sets role `user`, and sets status `banned` with reason `account_closed`;
- renames the profile to `deleted_<12 hex>`, removes the avatar, and sets `deleted_at` (the apps show "Usuario eliminado");
- deletes payment methods, favorites, blocks, notifications, and push tokens, and deletes addresses or scrubs the ones a shipment still references;
- soft-deletes listings that were never ordered and hides the rest;
- strips the `auth.users` credentials, sets `banned_until`, and deletes identities, sessions, and tokens, so the same email or Google account can register again as a new user.

Orders, shipments, payouts, and disputes stay as blocked ledger records. No job anonymizes them after five years yet (issue #67). A second call returns `already_closed` with the stored cleanup state.

## CAPTCHA

Supabase Auth enforces hCaptcha on `/signup`, `/recover`, `/resend`, and `/token?grant_type=password`. The clients send the token as `captchaToken`.

- Mobile: `signUp`, `signInWithPassword`, `resend`, `resetPasswordForEmail`, and the sign-in step of account closure, wrapped in `apps/frontend/src/shared/lib/auth/captcha-auth.logic.ts`.
- Admin-web: the login, through `apps/admin-web/src/lib/captcha/captchaAuth.logic.ts`.
- Exempt on the server: Google `signInWithIdToken`, `verifyOtp`, session refresh, and `updateUser`.

The provider is swappable in both apps. The contract is provider-agnostic (`apps/frontend/src/shared/lib/auth/captcha.logic.ts` on mobile, `apps/admin-web/src/lib/captcha/captcha.logic.ts` on admin-web). Only `apps/frontend/src/features/auth/components/captcha-provider.tsx` and `apps/admin-web/src/lib/captcha/useCaptcha.tsx` know hCaptcha. A request fails closed with `captcha_failed` when no provider is mounted or the challenge times out (120 s on mobile).

Locally, `[auth.captcha]` in `supabase/config.toml` is on with hCaptcha's public test secret. Set `EXPO_PUBLIC_HCAPTCHA_SITE_KEY` or `VITE_HCAPTCHA_SITE_KEY` to the test site key `10000000-ffff-ffff-ffff-000000000001` to run the widget, and Bruno sends `{{captchaToken}}` from `bruno/environments/local.bru`. With the site key empty, no widget shows and no token is sent. In production, the Dashboard switch must come after both builds carry the real site key. The order is in `docs/go-live.md`, section 10.

## Where each rule lives

| Rule                                                        | Enforced by                                                                              | Test                                                                                                                                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signup creates both profile rows; metadata cannot set role  | `fn_on_auth_user_created`                                                                | `supabase/tests/database/account_rules.test.sql`, `supabase/tests/database/reserved_usernames.test.sql`, Bruno `auth/signup-*`                                              |
| Usernames are valid, unique, and `deleted_` is reserved     | `fn_on_auth_user_created`, `tr_profiles_reserve_deleted_username`                        | `supabase/tests/database/reserved_usernames.test.sql`, `supabase/migrations/__tests__/auth_username_provisioning.test.ts`                                                   |
| Clients cannot write role, status, or trust columns         | Grants, `profiles_update`, `profiles_private_access`                                     | `supabase/tests/database/auth_grants.test.sql`, `supabase/tests/database/profile_grants.test.sql`, `supabase/tests/database/account_rules.test.sql`                         |
| Only an active admin changes status; banned is final        | `fn_admin_update_user_status`, `is_admin()`                                              | `supabase/tests/database/account_rules.test.sql`, `supabase/tests/database/suspension_hold.test.sql`                                                                        |
| Suspended and banned sellers cannot publish or edit         | `products_insert`, `products_update_owner`, `fn_current_account_is_active`               | `supabase/tests/database/account_rules.test.sql`                                                                                                                            |
| No new sale for a restricted seller; banned cannot buy      | `fn_reserve_products`                                                                    | `supabase/tests/database/account_rules.test.sql`, `supabase/tests/database/release_callers.test.sql`                                                                        |
| A hold is restored to the prior status on lift              | `fn_admin_update_user_status`, `fn_release_listings`                                     | `supabase/tests/database/suspension_hold.test.sql`, `supabase/tests/database/release_callers.test.sql`                                                                      |
| A listing keeps its publication economics                   | `validate_product_publication_economics`                                                 | `supabase/tests/database/publication_economics.test.sql`                                                                                                                    |
| Closure blockers refuse with nothing changed; anonymization | `fn_close_account`                                                                       | `supabase/tests/database/account_closure.test.sql`, `supabase/tests/database/account_closure_blockers.test.sql`, `supabase/migrations/__tests__/account_closure.test.ts`    |
| Recent sign-in and response codes of closure                | `supabase/functions/delete-account/handler.ts`                                           | `supabase/functions/delete-account/handler.test.ts`, Bruno `functions/delete-account-*`                                                                                     |
| Cleanup retry accepts only the cron secret                  | `account-closure-cleanup`, `supabase/functions/_shared/cron-auth.ts`                     | `supabase/functions/account-closure-cleanup/handler.test.ts`, Bruno `functions/account-closure-cleanup-*`                                                                   |
| Admin Edge Functions need an active admin                   | `supabase/functions/_shared/admin-auth.ts`                                               | `supabase/functions/_shared/__tests__/admin-auth.test.ts`                                                                                                                   |
| Admin-web admits only an active admin                       | `apps/admin-web/src/lib/adminAccess.ts`                                                  | `apps/admin-web/src/lib/adminAccess.test.ts`                                                                                                                                |
| Password change needs the current password                  | `apps/frontend/src/features/settings/logic/password-change.ts` and the Dashboard setting | `apps/frontend/src/features/settings/logic/password-change.test.ts`                                                                                                         |
| Password sign-in needs a CAPTCHA token                      | Supabase Auth `[auth.captcha]`                                                           | `bruno/auth/login-without-captcha-rejected.bru`, `apps/frontend/src/shared/lib/auth/captcha-auth.logic.test.ts`, `apps/admin-web/src/lib/captcha/captchaAuth.logic.test.ts` |

The pgTAP files are in `supabase/tests/database/`. The `account_restricted` and `active_orders` blockers have only the source-text check in `supabase/migrations/__tests__/account_closure.test.ts`, with no pgTAP assertion yet.

## How to test

- SQL rules: run `supabase start`, then `bun run test:db`. It runs the pgTAP files in `supabase/tests/database/` against the local database. CI runs the same command as the required check `db-test`. After a migration change, run `supabase db reset` first.
- Edge Functions and RPCs per role: run `bun run functions:serve`, then `bun run bruno:env`, then `bun run api:test`. Add a request in `bruno/` for each new rule.
- Frontend and admin-web logic: run `bun test <path>` for the touched file, then `bun run lint` and `bun run typecheck`.

Pitfalls:

- Lazy local services sleep when idle (`supabase/AGENTS.md`, "Local stack"), so the first call after a pause is slower. Run `supabase start` before any check.
- To run a pgTAP file by hand, wrap it in a transaction and run `create extension if not exists pgtap` first. The files already end with `rollback`.
- A migration applied by hand to the remote project does not prove itself. Read the result back through the Supabase MCP (`has_table_privilege`, `pg_get_functiondef`) before you call it done.
- Prove that a new test can fail: break the function or grant locally, run the test, then run `supabase db reset`.

## Decisions

The reasons behind these rules, and the evidence from each change, are in the `## Log` of [`odd/tasks/auth-hardening.md`](../odd/tasks/auth-hardening.md).
