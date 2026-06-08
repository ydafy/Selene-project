# Design: Account Settings Extended

## Technical Approach

Extend the current settings composition (`SettingsSection`/`SettingsRow` + `ConfirmDialog`) and add modal routes from the existing root stack. Reuse `useUpdateProfile`, `useUpdateAvatar`, `FormTextInput`, Toast, and the singleton Supabase client. Auth mutations use `supabase.auth.updateUser`; email DB sync is fixed with an idempotent `auth.users` UPDATE trigger. Covers CONF-011..CONF-020.

## Architecture Decisions

| Decision | Options / Tradeoff | Choice |
|---|---|---|
| Sensitive edits | Inline forms are cramped; dedicated routes are heavier. | Email/password use `ConfirmDialog` form modals. |
| Profile edit | Inline settings duplicates profile UX. | `/profile/edit` modal launched from `ProfileHeader`. |
| Legal links | WebView adds security/native surface. | Use installed `expo-web-browser`. |
| Password nonce | Timestamps/`Math.random` are weak. | Per-submit `Crypto.randomUUID()` from `expo-crypto`. |
| Modal registration | Requested `profile/_layout.tsx` does not exist. | Register `profile/edit` + `profile/support` in root `app/_layout.tsx`. |
| Chatwoot | Widget may fail in Expo Go. | Try widget route; fallback to browser URL. |

## Data Flow

```text
Profile tab ──ProfileHeader CTA──> /profile/edit
SettingsScreen
 ├─ AccountSection ──email dialog──> supabase.auth.updateUser({ email })
 ├─ SecuritySection ──password dialog──> updateUser({ password, currentPassword, nonce })
 ├─ Legal rows ──WebBrowser.openBrowserAsync(url)
 └─ Support row ──> /profile/support ──Chatwoot widget / WebBrowser fallback

auth.users UPDATE ──on_auth_user_updated──> profiles_private.email
```

Legal/version: add `Legales` after `Privacidad`; row order Terms, Privacy, Version. URLs come from `EXPO_PUBLIC_TERMS_URL`/`EXPO_PUBLIC_PRIVACY_URL`; invalid/rejected opens show localized Toast and leave UI retryable. Version uses `Constants.expoConfig?.version` and iOS build/android versionCode, fallback `unknown`.

Profile edit: auth-gated `/profile/edit` reads `useProfile(session.user.id)`, edits username with regex `^[A-Za-z0-9_.]+$` and length 3..20, closes without mutation if unchanged, calls `useUpdateProfile` on save, and reuses the existing Alert camera/gallery flow plus `useUpdateAvatar`.

Email: `AccountSection` adds an `email-outline` row. Dialog state: `email`, `localError`, `isSubmitting`. Validate email before submit. On success, close and show confirmation-copy Toast: email changes only after link confirmation. Auth/session errors stay open and prompt retry/re-login.

Password: `SecuritySection` adds `lock-reset` row. Dialog state: current/new/confirm/error/submitting. Validate current required, new min 8, confirmation match. Requires `@supabase/supabase-js >=2.102.0`; otherwise feature must not ship.

Chatwoot: `Soporte` section opens `/profile/support` only when `EXPO_PUBLIC_CHATWOOT_BASE_URL` and `EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN` exist; missing config shows localized unavailable Toast. Route renders widget and fallback button opening the chat URL via `expo-web-browser`.

DB: migration `CREATE OR REPLACE FUNCTION public.fn_on_auth_user_updated()` updates `public.profiles_private.email`, `last_sign_in_at`, `updated_at`; `DROP TRIGGER IF EXISTS`, then `CREATE TRIGGER on_auth_user_updated AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION...`. Do not reference removed `public.profiles.email`.

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/frontend/app/profile/settings.tsx` | Modify | Add Legal + Support sections in required order. |
| `apps/frontend/app/profile/edit.tsx` | Create | Profile edit modal. |
| `apps/frontend/app/profile/support.tsx` | Create | Chatwoot widget + fallback modal. |
| `apps/frontend/app/_layout.tsx` | Modify | Register modal routes. |
| `apps/frontend/components/features/settings/AccountSection.tsx` | Modify | Email-change row/dialog. |
| `apps/frontend/components/features/settings/SecuritySection.tsx` | Modify | Password-change row/dialog. |
| `apps/frontend/components/features/settings/SettingsRow.tsx` | Modify | Explicit non-tappable/value row support. |
| `apps/frontend/components/features/profile/ProfileHeader.tsx` | Modify | Add edit-profile CTA prop. |
| `apps/frontend/app/(tabs)/profile.tsx` | Modify | Push `/profile/edit`; share avatar upload logic if extracted. |
| `apps/frontend/core/i18n/locales/{es,en}/settings.json` | Modify | New legal/support/email/password/profile-edit keys. |
| `apps/frontend/package.json` | Modify | Supabase-js bump; add Chatwoot widget. |
| `supabase/queries/triggers/auth/fn_on_auth_user_updated.sql` | Modify | Correct trigger body. |
| `supabase/migrations/*_add_on_auth_user_updated_trigger.sql` | Create | Idempotent function + trigger migration. |

## Interfaces / Contracts

Env: `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_CHATWOOT_BASE_URL`, `EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN`.

Routes: `/profile/edit`, `/profile/support` with modal presentation.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Username/email/password validation, version formatter, nonce presence | `bun:test` pure helpers. |
| Component | Dialog disabled/error/success states and row order | React renderer/mocks for Supabase, Toast, WebBrowser. |
| Integration | `updateUser` payloads and profile mutation cache invalidation | Mock Supabase client + QueryClient. |
| DB | Confirmed email update syncs to `profiles_private.email`; migration idempotent | Local Supabase SQL assertions. |
| Smoke | Expo Go: legal links, edit modal, auth errors, Chatwoot fallback | Manual device pass. |

## Migration / Rollout

Deploy DB migration before enabling email-change UI. User upgrades Supabase dependency from root. No backfill required; current stale rows can be manually reconciled if discovered.

## Open Questions

- [ ] Final Terms/Privacy URLs and Chatwoot base URL/token values.
