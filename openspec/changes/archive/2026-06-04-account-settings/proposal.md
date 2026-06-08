# Proposal: Account Settings Page

## Intent

The Profile tab cog icon currently triggers logout — misleading UX. Users have no dedicated screen to edit their username, delete their account (legal requirement), or navigate to account-related areas (addresses, notifications). The `ProfileActionsBar` "Direcciones" button is a `console.log` placeholder. We need a production-grade `/profile/settings` screen that consolidates account management, includes legal must-haves, fixes broken navigation, and establishes the foundation for future settings (phone, notification prefs, language).

## Scope

### In Scope

- New screen `apps/frontend/app/profile/settings.tsx` with four sections: Cuenta, General, Seguridad y Privacidad.
- Inline `username` editing (validated, optimistic update against `profiles` table).
- Navigation links: Direcciones, Notificaciones (route to existing screens). Wallet excluded — module pending payment restructure.
- Logout action with `ConfirmDialog`.
- **Delete Account**: "Eliminar cuenta" with double-confirmation flow, typed confirmation phrase, and backend deletion logic via Supabase RPC/Edge Function (hard delete with cascade: auth.user + profiles + profiles_private + favorites + wallets).
- `useUpdateProfile` mutation hook in `useProfile.ts` (mirrors `useUpdateAvatar`).
- New `settings` i18n namespace (es/en) registered in `core/i18n/index.ts`.
- Fix `ProfileHeader` cog icon → `router.push('/profile/settings')`.
- Fix `ProfileActionsBar` "Direcciones" button → real route.

### Out of Scope

- Phone number editing (requires Edge Function for `profiles_private` Zero Trust write — deferred).
- Notification preferences UI (no DB layer exists — deferred to v2).
- Language selector / dark mode toggle (deferred to v3).
- Wallet link (module being restructured with new payment logic).
- Avatar editing duplication (settings shows preview only; edit flow stays on profile screen).
- RLS audit (tracked as separate tech-debt item; auth trigger fix already committed).
- Nice-to-have: app version display, data export, linked accounts, biometric lock toggle.

## Capabilities

### New Capabilities

- `account-settings`: Authenticated user manages their public profile (`username`), navigates to account-related screens, signs out, and permanently deletes their account from a single settings surface.

### Modified Capabilities

- None.

## Approach

Follow Approach A from exploration (frontend-only for username, single Edge Function/RPC for account deletion). Use Expo Router file-based routing, Restyle `Box`/`Text`, `GlobalHeader`, and existing form primitives (`FormTextInput`, `PrimaryButton`, `ConfirmDialog`). State via TanStack Query mutation with optimistic update on `profiles` cache. Validation via `zod` + `react-hook-form`. Account deletion: double-confirmation UI → Edge Function (or RPC) that hard-deletes auth.user + cascading data. All copy through i18n `settings` namespace — no hardcoded strings. Architect sections as discrete components so future items (phone, prefs) slot in without rewrites.

## Affected Areas

| Area                                                              | Impact   | Description                                                             |
| ----------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `apps/frontend/app/profile/settings.tsx`                          | New      | Main screen with sectioned cards.                                       |
| `apps/frontend/app/(tabs)/profile.tsx`                            | Modified | Cog icon → settings route, not logout.                                  |
| `apps/frontend/components/features/profile/ProfileActionsBar.tsx` | Modified | Direcciones routes to real screen.                                      |
| `apps/frontend/components/features/settings/`                     | New      | `AccountSection`, `GeneralSection`, `SecuritySection`, `UsernameField`, `DeleteAccountSection`. |
| `apps/frontend/core/hooks/useProfile.ts`                          | Modified | Add `useUpdateProfile`.                                                 |
| `apps/frontend/core/hooks/useDeleteAccount.ts`                    | New      | Mutation hook for account deletion RPC/Edge Function call.               |
| `supabase/functions/delete-account/index.ts`                      | New      | Edge Function: pre-check guard → Stripe cleanup (if applicable) → auth.user delete → cascade. |
| `apps/frontend/core/i18n/locales/{es,en}/settings.json`           | New      | Settings namespace.                                                     |
| `apps/frontend/core/i18n/index.ts`                                | Modified | Register `settings` namespace.                                          |

## Risks

| Risk                                                                   | Likelihood | Mitigation                                                            |
| ---------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------- |
| `profiles` RLS not in repo migrations — update may fail in fresh envs. | Med        | Verify avatar mutation still works; flag for separate RLS-audit task. |
| Username uniqueness collision on save.                                 | Med        | Catch Postgres `23505` error, show localized toast.                   |
| Username injection via special chars (breaks deep links).              | Med        | Zod regex: `^[a-zA-Z0-9_.]+$` on username field.                      |
| User taps logout mid-mutation.                                         | Low        | Disable logout while any settings mutation pending.                   |
| Account deletion is irreversible — data loss.                          | High       | Double-confirmation + typed phrase ("ELIMINAR"). |
| Account deleted with active obligations (shipments, disputes, balance). | **Critical** | Edge Function pre-check: block if shipments active (`status NOT IN completed/cancelled/refunded`), disputes open, payouts pending, or `available_balance > 0`. Return error with reason. |
| Orphaned Stripe Connect account after deletion.                        | Med        | Edge Function calls Stripe API to deactivate connected account (conditional — `stripe_connect_id` exists). If Stripe Connect not yet deployed, guarded with TODO. |
| Edge Function permission for auth.users delete.                        | Med        | Use service_role key. Verify Supabase admin API scope. |

## Rollback Plan

Single feature branch. Revert: delete `app/profile/settings.tsx` and `components/features/settings/`, `supabase/functions/delete-account/`, revert `useProfile.ts`, `ProfileHeader` cog handler, `ProfileActionsBar` Direcciones button, and unregister `settings` i18n namespace. Edge Function deploy is additive — no DB migrations, no schema changes.

## Dependencies

- Existing `/profile/notifications` and address screens must remain reachable by their current routes.
- Supabase service_role key available for Edge Function (account deletion).

## Success Criteria

- [ ] Cog icon on profile opens `/profile/settings` (not logout).
- [ ] User edits username, sees optimistic update, server confirms, toast on success/error.
- [ ] Direcciones / Notificaciones links navigate to working screens.
- [ ] Logout requires confirmation and signs out cleanly.
- [ ] "Eliminar cuenta" shows double-confirmation with typed phrase, triggers Edge Function, signs user out.
- [ ] Edge Function blocks deletion if active obligations exist (shipments, disputes, payouts, balance > 0) — returns clear error.
- [ ] Deleted account's data purged from DB (cascade: auth.user + profiles + profiles_private + favorites + wallets).
- [ ] All copy localized in `es` and `en`; no hardcoded strings.
- [ ] Username field validates against `^[a-zA-Z0-9_.]+$` (Zod schema).
- [ ] Zero new ESLint/TypeScript errors.
