# Design: Account Settings Page

## Technical Approach

Build `/profile/settings` as an authenticated Expo Router screen using existing Restyle `Box/Text`, `GlobalHeader`, `FormTextInput`, `PrimaryButton`, `ConfirmDialog`, Toast, and TanStack Query patterns. Username remains a direct `profiles` update like `useUpdateAvatar`; account deletion uses a new Supabase Edge Function with service-role pre-checks before irreversible deletion. Specs covered: CONF-001..CONF-010.

## Architecture Decisions

| Decision | Options / Tradeoff | Choice |
|---|---|---|
| Profile mutation | New hook file adds indirection; extending `useProfile.ts` mirrors avatar pattern. | Add `useUpdateProfile` to `useProfile.ts`. |
| Delete mutation | Direct client deletes are unsafe; Edge Function can use service role and auth admin API. | New `useDeleteAccount.ts` calling `supabase.functions.invoke('delete-account')`. |
| Sections | One screen is faster but grows messy. Separate components allow future phone/prefs. | Create feature components: `AccountSection`, `GeneralSection`, `SecuritySection`, `DeleteAccountSection`. |
| Username edit | Dedicated route overkill for one field; inline has more state but best UX. | Inline edit mode with RHF + Zod. |
| Delete safety | Auth + DB + Stripe cannot be one atomic transaction. | Pre-check all blockers, fetch external ids, attempt Stripe cleanup if supported, then `auth.admin.deleteUser`; log every step and return typed errors. |
| i18n | Reusing `profile` pollutes namespace. | New `settings` namespace in es/en. |

## Data Flow

```text
SettingsScreen ──useProfile(userId)──> profiles cache ['profile', userId]
  ├─ AccountSection ──useUpdateProfile──> profiles.update({ username })
  │      └─ onMutate optimistic cache; onError rollback; onSettled invalidate
  ├─ GeneralSection ──router.push──> /address/form, /profile/notifications
  ├─ SecuritySection ──ConfirmDialog──> supabase.auth.signOut()
  └─ DeleteAccountSection ──useDeleteAccount──> Edge Function delete-account
```

`useUpdateProfile` accepts `{ userId, username }`, validates UI with `usernameSchema = z.object({ username: z.string().regex(/^[a-zA-Z0-9_.]+$/) })`, updates `profiles.username`, catches Postgres `23505`, and maps it to `settings:errors.usernameTaken`.

`useDeleteAccount` sends no user id from client; function derives identity from Bearer token. Success signs out and clears `['profile', userId]` plus user-scoped queries.

## Component Contracts

```ts
type AccountSectionProps = { userId: string; username: string | null; isLoading: boolean };
type GeneralSectionProps = { onRouteError?: (key: string) => void };
type SecuritySectionProps = { disabled: boolean };
type DeleteAccountSectionProps = { disabled: boolean };
```

Settings screen owns dialog visibility, route fallback toast, and pending aggregation: `updateProfile.isPending || deleteAccount.isPending || isLoggingOut`.

## Edge Function Contract

`POST /functions/v1/delete-account`

Responses:
- `200 { success: true }`
- `409 { error: 'DELETE_BLOCKED', blocked_reason: 'active_shipments' | 'open_disputes' | 'pending_payouts' | 'available_balance' }`
- `401 { error: 'AUTH_REQUIRED' }`
- `400/500 { error: 'DELETE_FAILED' | 'STRIPE_CLEANUP_FAILED' }`

Pre-check queries use `shipments.seller_id = user.id` with status not in `completed,cancelled,refunded`; `disputes` where buyer/seller and status not in `resolved,rejected`; `payout_requests.status in pending,processing`; `wallets.available_balance > 0`. Current types expose `profiles_private.stripe_customer_id` but no `stripe_connect_id`; keep guarded TODO until Connect column lands.

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/frontend/app/profile/settings.tsx` | Create | Screen, auth gate, scroll layout, header, sections. |
| `apps/frontend/components/features/settings/*.tsx` | Create | Four sections plus reusable settings row/card helpers if needed. |
| `apps/frontend/core/hooks/useProfile.ts` | Modify | Add `useUpdateProfile` optimistic mutation. |
| `apps/frontend/core/hooks/useDeleteAccount.ts` | Create | Delete mutation and typed error mapping. |
| `supabase/functions/delete-account/index.ts` | Create | Auth, pre-check, optional Stripe cleanup, auth user delete. |
| `apps/frontend/components/features/profile/ProfileHeader.tsx` | Modify | Rename prop to `onSettingsPress`; cog navigates, no logout. |
| `apps/frontend/app/(tabs)/profile.tsx` | Modify | Pass `router.push('/profile/settings')`; keep logout out of header. |
| `apps/frontend/components/features/profile/ProfileActionsBar.tsx` | Modify | Route Direcciones to `/address/form`; remove placeholder logs. |
| `apps/frontend/core/i18n/index.ts` | Modify | Import/register `settings`. |
| `apps/frontend/core/i18n/locales/{es,en}/settings.json` | Create | Titles, rows, dialogs, toasts, blocked reasons. |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | username regex, 23505 mapping, delete blocked reason mapping | `bun:test` pure helper tests. |
| Unit | Edge pre-check decision order | Extract helpers in function or colocated pure functions with mocked client. |
| Integration | optimistic username rollback/invalidate | Hook tests with mocked query client/Supabase chain. |
| Integration | navigation fixes | Component tests or manual Expo route verification. |

## Migration / Rollout

No DB migration required for current types. Deploy Edge Function after env verification. Add Connect cleanup only when `stripe_connect_id` exists in schema/types.

## Open Questions

- [ ] Address list route does not exist; current live address route is `/address/form`. Use it for v1.
