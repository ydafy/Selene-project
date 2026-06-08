# Settings Domain Specification

## Overview

This domain covers the `/profile/settings` screen in the Selene mobile app, including account profile editing, navigation to related screens, logout, and account deletion.

## Requirements

### Requirement: CONF-001 — Settings Screen Rendering
**Priority**: HIGH  
**Description**: `/profile/settings` MUST render sections in order: Cuenta, General, Seguridad, Privacidad.
#### Acceptance Criteria
- GIVEN an authenticated user
- WHEN opening `/profile/settings`
- THEN all four sections and header controls are visible
#### Edge Cases
- Loading state MUST show skeletons for username row.

### Requirement: CONF-002 — Username Editing
**Priority**: HIGH  
**Description**: Username edit MUST validate with `^[a-zA-Z0-9_.]+$`, use optimistic update, and rollback on backend error.
#### Acceptance Criteria
- GIVEN a valid username input
- WHEN user saves
- THEN cache updates immediately and persists after success
#### Edge Cases
- Invalid regex input MUST block submit.
- Postgres `23505` MUST show localized "username taken" error and rollback.

### Requirement: CONF-003 — Settings Navigation Links
**Priority**: HIGH  
**Description**: Settings MUST route Direcciones and Notificaciones to live screens; Wallet MUST NOT appear in this change.
#### Acceptance Criteria
- GIVEN user on settings
- WHEN tapping Direcciones or Notificaciones
- THEN app navigates to the correct route
#### Edge Cases
- Broken route MUST show localized error fallback.

### Requirement: CONF-004 — Logout Confirmation
**Priority**: MEDIUM  
**Description**: Logout MUST require `ConfirmDialog` confirmation before `supabase.auth.signOut()`.
#### Acceptance Criteria
- GIVEN user taps "Cerrar sesión"
- WHEN confirming dialog
- THEN sign-out completes and auth-guest view is shown
#### Edge Cases
- Pending logout MUST disable repeat taps.

### Requirement: CONF-005 — Delete Account Flow
**Priority**: HIGH  
**Description**: Delete flow MUST require double confirmation and typed phrase `ELIMINAR` before Edge Function call.
#### Acceptance Criteria
- GIVEN user opens delete account action
- WHEN confirmations pass and phrase is exactly `ELIMINAR`
- THEN delete function is called once and user is signed out on success
#### Edge Cases
- Phrase mismatch MUST keep destructive submit disabled.

### Requirement: CONF-006 — Delete Account Pre-check Guard
**Priority**: HIGH  
**Description**: Edge Function MUST block deletion when blockers exist and return a specific `blocked_reason` mapped to i18n UI text.
#### Acceptance Criteria
- GIVEN any blocker exists
- WHEN deletion is requested
- THEN function returns specific reason and deletion is denied
#### Edge Cases
- Blockers include: active shipments (`status NOT IN completed/cancelled/refunded`), active disputes (`status NOT IN resolved/rejected`), payout requests in `pending|processing`, or `wallets.available_balance > 0`.

### Requirement: CONF-007 — i18n Coverage
**Priority**: HIGH  
**Description**: All settings strings MUST be in `settings` namespace for `es` and `en`; hardcoded UI strings are prohibited.
#### Acceptance Criteria
- GIVEN locale `es` or `en`
- WHEN rendering settings and error flows
- THEN labels, dialogs, and toasts resolve from translation keys
#### Edge Cases
- Missing key MUST fallback to default locale path.

### Requirement: CONF-008 — Loading/Error/Pending States
**Priority**: MEDIUM  
**Description**: Screen SHOULD provide production feedback for fetch, mutation, and network failures.
#### Acceptance Criteria
- GIVEN username save or deletion is pending
- WHEN user tries duplicate actions
- THEN buttons are disabled and loading indicators are shown
#### Edge Cases
- Network failure MUST keep form input and allow retry.

### Requirement: CONF-009 — Profile Cog Icon Fix
**Priority**: HIGH  
**Description**: Profile cog action MUST navigate to `/profile/settings` and MUST NOT log out.
#### Acceptance Criteria
- GIVEN profile tab is open
- WHEN user taps cog icon
- THEN router pushes `/profile/settings`
#### Edge Cases
- Rapid taps SHOULD result in one navigation intent.

### Requirement: CONF-010 — ProfileActionsBar Direcciones Fix
**Priority**: HIGH  
**Description**: `ProfileActionsBar` Direcciones MUST navigate to a real address route, replacing console placeholder behavior.
#### Acceptance Criteria
- GIVEN profile actions bar is visible
- WHEN Direcciones is tapped
- THEN app navigates to address screen
#### Edge Cases
- Unauthenticated state MUST follow existing auth-gate behavior.

## Notes
- Delete Edge Function SHOULD call `stripe.accounts.del` when a Connect account id exists.
- If Connect id is not yet deployed in schema, function MUST short-circuit safely and keep TODO guard.
