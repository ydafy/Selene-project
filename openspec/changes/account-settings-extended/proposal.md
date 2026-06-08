# Proposal: Account Settings Extended

## Intent

Extend `/profile/settings` and the Profile tab with five user-facing capabilities that complete the post-launch account surface: legal/version info, edit-profile modal, email change, password change, and Chatwoot support. The base settings cycle shipped only account-level basics (username, addresses, logout, delete). Users currently have no way to change email/password from the app, no legal access, no support channel, and no unified "edit profile" entry. This change closes those gaps using existing patterns (`SettingsSection`/`SettingsRow`/`ConfirmDialog`, `useUpdateProfile`, `useUpdateAvatar`) so no new architecture is introduced.

## Scope

### In Scope
- New `Legales` section with Terms + Privacy rows (open via `expo-web-browser`) and a non-tappable version row using `expo-constants`.
- New modal route `/profile/edit` with username + avatar fields, reusing `useUpdateProfile` and `useUpdateAvatar`.
- Email change modal in `AccountSection` calling `auth.updateUser({ email })` with confirmation-flow copy.
- Password change modal in `SecuritySection` with current + new + confirm fields using `auth.updateUser({ password, nonce })`.
- New `Soporte` section with Chatwoot widget integration (placeholder URL/token).
- DB migration creating `on_auth_user_updated` trigger on `auth.users` and fixing `fn_on_auth_user_updated` to update `profiles_private.email`.
- i18n keys for all new strings under `settings` namespace (`es` + `en`).

### Out of Scope
- Actual Chatwoot domain/token provisioning (placeholders; user swaps later).
- Actual Terms/Privacy hosted URLs (placeholders; user swaps later).
- 2FA, biometric unlock, session management UI.
- Phone/MFA changes.

## Capabilities

### New Capabilities
- `profile-edit-modal`: dedicated `/profile/edit` modal route for editing username + avatar from the Profile tab.

### Modified Capabilities
- `settings`: adds email change, password change, legal section, version row, and support section to the existing `/profile/settings` screen.

## Approach

Build per-feature in the order recommended by explore (low-risk first): Legales/Version → Profile Edit Modal → DB trigger fix + Email Change → Password Change → Chatwoot. Each feature is an isolated modal or section that plugs into the existing `SettingsSection`/`SettingsRow` composition. All auth mutations go through `supabase.auth.updateUser` (no custom edge functions). DB trigger fix lands first as a separate migration to unblock email sync. Chatwoot uses placeholder env vars; if `@chatwoot/react-native-widget` is incompatible with Expo SDK 54, fall back to `expo-web-browser` opening Chatwoot URL directly.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/frontend/app/profile/settings.tsx` | Modified | Add Legales + Soporte sections |
| `apps/frontend/app/profile/edit.tsx` | New | Edit profile modal route |
| `apps/frontend/app/profile/_layout.tsx` | Modified | Register modal presentation |
| `apps/frontend/components/features/settings/AccountSection.tsx` | Modified | Add email change row |
| `apps/frontend/components/features/settings/SecuritySection.tsx` | Modified | Add password change row |
| `apps/frontend/components/features/settings/SettingsRow.tsx` | Modified | Add non-tappable variant for version |
| `apps/frontend/components/features/profile/ProfileHeader.tsx` | Modified | Add "Editar perfil" entry point |
| `apps/frontend/core/i18n/locales/{es,en}/settings.json` | Modified | New keys |
| `apps/frontend/.env` + `.env.example` | Modified | Chatwoot placeholders |
| `apps/frontend/package.json` | Modified | Add `@chatwoot/react-native-widget` |
| `supabase/migrations/YYYYMMDD_on_auth_user_updated.sql` | New | Trigger + function fix |
| `supabase/queries/triggers/auth/fn_on_auth_user_updated.sql` | Modified | Update `profiles_private.email` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| DB trigger migration breaks auth signup/update | Low | Idempotent migration; test in local Supabase before deploy |
| `@chatwoot/react-native-widget` incompatible with Expo SDK 54 | Medium | Test in Expo Go first; fallback to `expo-web-browser` opening Chatwoot URL |
| Users confused by email confirmation flow | Medium | Explicit modal copy: "Te enviamos un correo. Tu email no cambia hasta que confirmes." |
| Password change without `currentPassword` allows session-token takeover | Medium | Require `@supabase/supabase-js ^2.102.0` upgrade before shipping password feature |
| Placeholder URLs/tokens leaked to production | Low | Mark env vars `EXPO_PUBLIC_*` clearly; CI check for placeholder values pre-release |

## Rollback Plan

- **Code**: Each feature is additive and isolated behind a new section/route. Revert by removing the section/row + modal file; no shared code is mutated destructively.
- **DB trigger**: Migration is reversible — drop trigger + revert function body to prior state via down-migration.
- **Dependency**: `@chatwoot/react-native-widget` can be removed cleanly; `bun remove` + drop Soporte section.
- **No data migration** is required; trigger only writes future-tense rows.

## Dependencies

- `@chatwoot/react-native-widget` (new — user installs)
- `@supabase/supabase-js ^2.102.0` (user upgrades from root via `bun update`)
- DB trigger migration MUST land and deploy before Email Change ships.

## Success Criteria

- [ ] User can open Terms and Privacy from Settings and see app version.
- [ ] User can edit username + avatar from `/profile/edit` modal accessed via Profile tab.
- [ ] User can request email change and receive Supabase confirmation email; `profiles_private.email` syncs after confirmation.
- [ ] User can change password with current-password verification (post supabase-js upgrade).
- [ ] User can open Chatwoot support from Settings (or fallback URL).
- [ ] All new strings localized in `es` and `en`; no hardcoded UI text.
- [ ] DB trigger `on_auth_user_updated` exists in production and fires on email update.

## Deferred to Future

- Real Chatwoot domain + token (post-provisioning).
- Real Terms/Privacy hosted URLs (post legal team).
- Phone change, MFA, biometric unlock, active sessions list.
- Re-authentication challenge for sensitive changes (currently relies on session validity).
