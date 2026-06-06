# Tasks: Account Settings Extended

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~830 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 foundation → PR 2 legal/profile → PR 3 email/password/chatwoot |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain (local commits — 3 batches, no PR push)
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Fix DB sync + add shared i18n/base helpers | PR 1 | Foundation; unblock email flow. |
| 2 | Ship legal/version + profile edit modal | PR 2 | Independent UI slice; includes route wiring. |
| 3 | Ship email/password/support settings flows | PR 3 | Depends on foundation; includes external deps. |

## Phase 1: Foundation

- [x] EXTD-TASK-001: Create idempotent migration for `auth.users` update trigger and sync `profiles_private.email`; verify no reference to removed `profiles.email`. **Priority**: HIGH **Depends on**: none **Estimated lines**: 90 **Specs**: [CONF-019] **Files**: `supabase/migrations/*_on_auth_user_updated*.sql`, `supabase/queries/triggers/auth/fn_on_auth_user_updated.sql` **Description**: Fix the auth update trigger path so confirmed email changes propagate to `profiles_private`. **Acceptance criteria**: [ ] trigger exists after migration [ ] re-running migration is safe [ ] email sync uses `NEW.email`
- [x] EXTD-TASK-002: Add all new `settings` i18n keys in `apps/frontend/core/i18n/locales/{es,en}/settings.json`. **Priority**: HIGH **Depends on**: EXTD-TASK-001 **Estimated lines**: 120 **Specs**: [CONF-020] **Files**: `apps/frontend/core/i18n/locales/es/settings.json`, `apps/frontend/core/i18n/locales/en/settings.json` **Description**: Seed translation keys for legal, edit profile, email, password, support, and version strings. **Acceptance criteria**: [ ] every new label/message resolves from `settings.*` [ ] `es` and `en` both contain keys

## Phase 2: Legales + Version

- [ ] EXTD-TASK-003: Extend `SettingsRow` with a non-tappable/value row variant for app version display. **Priority**: MEDIUM **Depends on**: EXTD-TASK-002 **Estimated lines**: 35 **Specs**: [CONF-014] **Files**: `apps/frontend/components/features/settings/SettingsRow.tsx` **Description**: Support a static row without chevron/tap affordance. **Acceptance criteria**: [ ] version row renders as plain value [ ] existing tappable rows unchanged
- [ ] EXTD-TASK-004: Add `Legales` section to `/profile/settings` and open Terms/Privacy URLs via `expo-web-browser`. **Priority**: HIGH **Depends on**: EXTD-TASK-003 **Estimated lines**: 70 **Specs**: [CONF-011, CONF-012, CONF-013, CONF-014] **Files**: `apps/frontend/app/profile/settings.tsx` **Description**: Render Terms, Privacy, and Version in the required order. **Acceptance criteria**: [ ] section appears after Privacy area [ ] browser opens correct URL [ ] invalid URL shows localized error

## Phase 3: Profile Edit Modal

- [ ] EXTD-TASK-005: Register modal presentation for `/profile/edit` and add a Profile CTA entry point. **Priority**: HIGH **Depends on**: EXTD-TASK-002 **Estimated lines**: 60 **Specs**: [CONF-015] **Files**: `apps/frontend/app/_layout.tsx`, `apps/frontend/components/features/profile/ProfileHeader.tsx`, `apps/frontend/app/(tabs)/profile.tsx` **Description**: Wire native modal navigation from the profile surface. **Acceptance criteria**: [ ] route opens as modal [ ] CTA visible on profile screen
- [ ] EXTD-TASK-006: Build `/profile/edit` modal using `FormTextInput`, `useUpdateProfile`, and `useUpdateAvatar`. **Priority**: HIGH **Depends on**: EXTD-TASK-005 **Estimated lines**: 170 **Specs**: [CONF-015] **Files**: `apps/frontend/app/profile/edit.tsx` **Description**: Edit username/avatar with validation and optimistic save behavior. **Acceptance criteria**: [ ] username validation blocks invalid saves [ ] unchanged submit closes without mutation [ ] avatar errors do not corrupt existing avatar

## Phase 4: Email Change

- [ ] EXTD-TASK-007: Add an email-change `ConfirmDialog` flow in `AccountSection` using `supabase.auth.updateUser({ email })`. **Priority**: HIGH **Depends on**: EXTD-TASK-001, EXTD-TASK-002 **Estimated lines**: 115 **Specs**: [CONF-016] **Files**: `apps/frontend/components/features/settings/AccountSection.tsx` **Description**: Let users request an email change and explain confirmation-step behavior. **Acceptance criteria**: [ ] invalid email blocked [ ] success copy explains confirmation email [ ] auth errors stay retryable

## Phase 5: Password Change

- [ ] EXTD-TASK-008: Bump `@supabase/supabase-js` to a version supporting `currentPassword` and keep auth regressions green. **Priority**: HIGH **Depends on**: none **Estimated lines**: 20 **Specs**: [CONF-017] **Files**: `apps/frontend/package.json` **Description**: Enable secure password change API usage. **Acceptance criteria**: [ ] dependency meets `currentPassword` requirement [ ] lockfile updated
- [ ] EXTD-TASK-009: Add password-change `ConfirmDialog` flow in `SecuritySection` with nonce + current password validation. **Priority**: HIGH **Depends on**: EXTD-TASK-008, EXTD-TASK-002 **Estimated lines**: 120 **Specs**: [CONF-017] **Files**: `apps/frontend/components/features/settings/SecuritySection.tsx` **Description**: Collect current/new/confirm passwords and submit a secure update. **Acceptance criteria**: [ ] current password required [ ] mismatch blocked [ ] nonce generated per submit [ ] success toast shown

## Phase 6: Chatwoot

- [ ] EXTD-TASK-010: Add Chatwoot dependency/env placeholders and a `Soporte` entry that opens widget or browser fallback. **Priority**: MEDIUM **Depends on**: EXTD-TASK-002 **Estimated lines**: 140 **Specs**: [CONF-018] **Files**: `apps/frontend/package.json`, `apps/frontend/.env`, `apps/frontend/.env.example`, `apps/frontend/app/profile/support.tsx`, `apps/frontend/app/profile/settings.tsx` **Description**: Provide support entry with graceful fallback when Chatwoot is unavailable. **Acceptance criteria**: [ ] support row visible [ ] widget opens when configured [ ] browser fallback works [ ] missing config shows localized message

## Phase 7: Testing

- [ ] EXTD-TASK-011: Add `bun:test` coverage for validators, version formatting, and trigger SQL idempotence assumptions. **Priority**: HIGH **Depends on**: EXTD-TASK-001, EXTD-TASK-002, EXTD-TASK-003 **Estimated lines**: 90 **Specs**: [CONF-014, CONF-015, CONF-016, CONF-017, CONF-019, CONF-020] **Files**: relevant feature test files next to implementation **Description**: Cover the core logic before wiring. **Acceptance criteria**: [ ] validation helpers tested [ ] version string formatter tested [ ] SQL migration assertions covered
- [ ] EXTD-TASK-012: Add component/integration tests for settings row order, modal navigation, auth payloads, and error states. **Priority**: HIGH **Depends on**: EXTD-TASK-004, EXTD-TASK-006, EXTD-TASK-007, EXTD-TASK-009, EXTD-TASK-010 **Estimated lines**: 130 **Specs**: [CONF-011, CONF-012, CONF-013, CONF-015, CONF-016, CONF-017, CONF-018] **Files**: `apps/frontend/**/__tests__/*` or colocated test files **Description**: Verify the visible behavior matches the spec scenarios. **Acceptance criteria**: [ ] legal order tested [ ] modal route tested [ ] email/password payloads asserted [ ] support fallback tested
