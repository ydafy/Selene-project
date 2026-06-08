# Delta for account-settings-extended

## Affected Domains
- Mobile UI: Profile tab, Settings screen, modals
- Navigation: Expo Router routes (`/profile/settings`, `/profile/edit`)
- Auth: Supabase Auth (`auth.updateUser`)
- External links: `expo-web-browser`
- Support: Chatwoot (widget + web fallback)
- Data: Postgres trigger/function on `auth.users` syncing `profiles_private.email`
- Localization: i18n `settings` namespace (`es`, `en`)

## ADDED Requirements

### Requirement: CONF-011 — Legal Section Rendering + Order
**Priority**: HIGH  
**Description**: `/profile/settings` MUST render a `Legales` section after `Privacidad` and MUST render rows in this order: `Términos`, `Privacidad`, `Versión` (non-tappable).
#### Acceptance Criteria
- GIVEN an authenticated user on `/profile/settings`
- WHEN the screen finishes rendering
- THEN the `Legales` section is visible and row order matches: Terms, Privacy, Version
#### Edge Cases
- If session is missing, screen MUST follow existing auth-gate redirect behavior.

### Requirement: CONF-012 — Terms Navigation (expo-web-browser)
**Priority**: HIGH  
**Description**: Tapping `Términos` MUST open the Terms URL via `expo-web-browser` and MUST show a localized error message if the URL cannot be opened.
#### Acceptance Criteria
- GIVEN the Terms URL is configured
- WHEN the user taps `Términos`
- THEN the system browser opens to the Terms URL
#### Edge Cases
- Missing/invalid URL MUST NOT crash and MUST show a localized failure toast.

### Requirement: CONF-013 — Privacy Navigation (expo-web-browser)
**Priority**: HIGH  
**Description**: Tapping `Privacidad` MUST open the Privacy URL via `expo-web-browser` and MUST show a localized error message if the URL cannot be opened.
#### Acceptance Criteria
- GIVEN the Privacy URL is configured
- WHEN the user taps `Privacidad`
- THEN the system browser opens to the Privacy URL
#### Edge Cases
- If `openBrowserAsync()` rejects, the UI MUST remain usable and allow retry.

### Requirement: CONF-014 — App Version Row Format (expo-constants)
**Priority**: MEDIUM  
**Description**: The version row MUST render the exact format `Selene vX.Y.Z (Build N)` using values derived from `expo-constants`.
#### Acceptance Criteria
- GIVEN the app has version and build info available via `expo-constants`
- WHEN `/profile/settings` renders the version row
- THEN the label matches `Selene vX.Y.Z (Build N)`
#### Edge Cases
- If version/build is unavailable, the row MUST still render using `unknown` placeholders.

### Requirement: CONF-015 — Profile Edit Modal Route + Validation
**Priority**: HIGH  
**Description**: The app MUST provide a modal route `/profile/edit` to edit username and avatar. Username MUST validate `^[A-Za-z0-9_.]+$`, MUST be length 3..20, and MUST block save on invalid input.
#### Acceptance Criteria
- GIVEN an authenticated user opens `/profile/edit`
- WHEN the user enters a valid username and saves
- THEN `useUpdateProfile` persists the username and the modal closes on success
#### Edge Cases
- If username is unchanged, save SHOULD close without mutation.
- Avatar update failures MUST show a localized error and MUST NOT corrupt existing avatar.

### Requirement: CONF-016 — Email Change Flow + Messaging
**Priority**: HIGH  
**Description**: Settings MUST offer an email change flow that calls `supabase.auth.updateUser({ email })` and MUST communicate that the email does not change until the user confirms via the email link.
#### Acceptance Criteria
- GIVEN a signed-in user submits a valid new email
- WHEN `auth.updateUser({ email })` succeeds
- THEN the UI shows a localized success message describing the confirmation step
#### Edge Cases
- Invalid email MUST block submit with localized validation.
- Auth/session errors MUST show a localized error and SHOULD prompt re-login.

### Requirement: CONF-017 — Password Change Flow (nonce) + Validations
**Priority**: HIGH  
**Description**: Settings MUST provide a password change flow requiring current password, new password, and confirmation. On submit, the client MUST generate a per-request `nonce` and MUST call `supabase.auth.updateUser({ password: newPassword, nonce, currentPassword })`.
#### Acceptance Criteria
- GIVEN a signed-in user enters matching new passwords (min 8 chars) and provides current password
- WHEN the user submits the form
- THEN the password update is attempted once and a localized success message is shown on success
#### Edge Cases
- New/confirm mismatch MUST block submit.
- If the installed `supabase-js` lacks `currentPassword` support, the feature MUST NOT ship (dependency upgrade required).

### Requirement: CONF-018 — Chatwoot Support Open + Web Fallback
**Priority**: MEDIUM  
**Description**: Settings MUST provide a `Soporte` entry that opens the Chatwoot widget when available; if the widget cannot open, it MUST fall back to opening Chatwoot via `expo-web-browser`.
#### Acceptance Criteria
- GIVEN Chatwoot configuration is present
- WHEN the user taps the support entry
- THEN Chatwoot opens (widget or browser fallback) without crashing the app
#### Edge Cases
- Missing config MUST show a localized “support unavailable” message.

### Requirement: CONF-019 — Idempotent DB Trigger Fix for Email Sync
**Priority**: HIGH  
**Description**: A migration MUST be idempotent and MUST ensure `auth.users` UPDATE events sync `NEW.email` into `public.profiles_private.email` via `fn_on_auth_user_updated`, and MUST create the `on_auth_user_updated` trigger if missing.
#### Acceptance Criteria
- GIVEN an email change is confirmed and `auth.users.email` changes
- WHEN the update trigger fires
- THEN `profiles_private.email` is updated to the new value
#### Edge Cases
- Migration MUST NOT reference a removed `profiles.email` column.
- Re-applying the migration MUST NOT create duplicate triggers.

### Requirement: CONF-020 — i18n Coverage for New Settings Strings
**Priority**: HIGH  
**Description**: All new strings introduced by this change MUST use i18n keys under the `settings` namespace and MUST be present for `es` and `en`.
#### Acceptance Criteria
- GIVEN locale `es` or `en`
- WHEN rendering legal/support/password/email/profile-edit UI and messages
- THEN all text resolves from `settings.*` translation keys
#### Edge Cases
- Missing keys MUST fallback per the app's existing i18n fallback behavior and SHOULD be detectable in development.
