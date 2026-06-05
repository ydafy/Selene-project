# Tasks: Account Settings Page

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 520-700 |
| New files | 7 |
| Modified files | 4 |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Settings foundations + i18n + profile mutations | PR 1 | Base UI copy, optimistic update hook, delete hook types |
| 2 | Delete-account Edge Function | PR 1 | Server-side guard + auth deletion path |
| 3 | Screen wiring + profile fixes | PR 1 | Route fixes and settings screen assembly |
| 4 | TDD coverage | PR 1 | bun:test for hooks, helpers, and section rendering |

## Phase 1: Foundation

- [x] 1.1 Add `core/i18n/locales/es/settings.json` and `core/i18n/locales/en/settings.json` with section labels, dialog copy, toasts, and blocked-reason keys.
- [x] 1.2 Register the `settings` namespace in `core/i18n/index.ts` and verify namespace fallback loads cleanly.
- [x] 1.3 Extend `core/hooks/useProfile.ts` with `useUpdateProfile` optimistic mutation for `username` and `23505` rollback mapping.
- [x] 1.4 Create `core/hooks/useDeleteAccount.ts` with typed delete result handling and sign-out-friendly success flow.

## Phase 2: Edge Function

- [x] 2.1 Create `supabase/functions/delete-account/index.ts` with bearer-token auth, ownership derivation, and pre-check helpers for shipments, disputes, payouts, and wallet balance.
- [x] 2.2 Implement `blocked_reason` responses and Stripe Connect cleanup guard so missing connect ids short-circuit safely.
- [x] 2.3 Add a destructive delete path that calls `auth.admin.deleteUser` after blockers pass and returns typed errors on failure.

## Phase 3: Component Wiring

- [x] 3.1 Create `components/features/settings/AccountSection.tsx`, `GeneralSection.tsx`, `SecuritySection.tsx`, and `DeleteAccountSection.tsx` using existing Restyle/form primitives.
- [x] 3.2 Update `components/features/profile/ProfileHeader.tsx` so the cog opens `/profile/settings` instead of logging out.
- [x] 3.3 Update `components/features/profile/ProfileActionsBar.tsx` so “Direcciones” routes to `/address/form` and no placeholder log remains.
- [x] 3.4 Wire `app/(tabs)/profile.tsx` to pass the settings navigation handler and keep logout in the settings screen only.

## Phase 4: Screen Assembly

- [x] 4.1 Create `app/profile/settings.tsx` with authenticated scroll layout, stack title, skeleton row, and section ordering: Cuenta → General → Seguridad → Privacidad.
- [x] 4.2 Connect inline username editing, navigation rows, logout confirmation, and delete-account double-confirmation flows.
- [x] 4.3 Ensure pending states disable repeat actions and route failures surface localized fallback toasts.

## Phase 5: Testing

- [x] 5.1 Write `bun:test` unit tests for username regex validation, `23505` mapping, and delete blocked-reason helper output.
- [x] 5.2 Test `useUpdateProfile` optimistic update/rollback with a mocked query client and Supabase chain.
- [x] 5.3 Test delete-account helper paths for auth-required, blocked, and success cases.
- [ ] 5.4 Verify settings section rendering and route handlers in component tests or minimal route smoke checks. _(Skipped: project has no React Native Testing Library setup. Pure helpers cover the rendering logic that is testable in isolation.)_
