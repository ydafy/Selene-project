# Connect Onboarding Sync Specification

## Purpose

Synchronize Stripe Connect onboarding status between Stripe, Selene DB, seller app, and admin dashboard.

## Requirements

### Requirement: Deep Link Return Handling

The system MUST intercept `selene://sell/onboarding` deep links from Stripe redirects without 404, with web fallback.

#### Scenario: Mobile return from Stripe

- GIVEN seller completes Stripe onboarding in `expo-web-browser`
- WHEN Stripe redirects to `selene://sell/onboarding?return=1`
- THEN app navigates to onboarding screen and triggers refresh

#### Scenario: Android intent filter

- GIVEN Android device with Selene installed
- WHEN system receives `selene://sell/onboarding` intent
- THEN app opens onboarding screen directly

### Requirement: Webhook Status Updates

The system MUST process `account.updated` webhooks to update `profiles_private.stripe_onboarding_status`: `charges_enabled && payouts_enabled` → `complete`; `disabled_reason` (not `requirements.past_due`) → `rejected`; else → `pending`.

#### Scenario: Account marked complete

- GIVEN `charges_enabled: true` and `payouts_enabled: true`
- WHEN `account.updated` webhook arrives
- THEN status set to `complete`

#### Scenario: Account rejected

- GIVEN `disabled_reason` present, not `requirements.past_due`
- WHEN `account.updated` webhook arrives
- THEN status set to `rejected`

#### Scenario: v1/v2 shape normalization

- GIVEN webhook payload is v1 or v2 shape
- WHEN handler processes event
- THEN shape normalized and status computed correctly

### Requirement: Active Reconciliation Edge Function

The system MUST provide `refresh-connect-account-status` Edge Function. Sellers refresh own account only; admins refresh any. DB writes MUST use `service_role`.

#### Scenario: Seller refreshes own status

- GIVEN seller with valid `stripe_account_id` calls refresh
- WHEN function verifies `auth.uid()` ownership
- THEN Stripe called and `profiles_private` updated

#### Scenario: Admin refreshes any seller

- GIVEN admin (`profiles_private.role = 'admin'`) calls with target `user_id`
- WHEN function verifies admin role from DB (not JWT)
- THEN target's account retrieved and updated

#### Scenario: Cross-seller access denied

- GIVEN seller A calls with seller B's `user_id`
- WHEN ownership check fails, caller not admin
- THEN 403 returned, no Stripe call

### Requirement: Server-Side Throttle

The system MUST check `stripe_onboarding_refreshed_at` before Stripe calls. If < 60s and `force !== true`, return cached DB state.

#### Scenario: Throttle blocks rapid call

- GIVEN last refresh 30s ago, no `force` flag
- WHEN refresh called
- THEN cached status returned, no Stripe call

#### Scenario: Force bypasses throttle

- GIVEN last refresh 30s ago, `force: true`
- WHEN admin calls refresh
- THEN Stripe called and status updated

### Requirement: Frontend Focus-Based Refresh

Onboarding screen MUST call refresh on `useFocusEffect`, `AppState` → `active`, and `WebBrowser.dismissBrowser`. UI shows loading + correct status.

#### Scenario: Focus triggers refresh

- GIVEN seller navigates to onboarding
- WHEN `useFocusEffect` fires
- THEN refresh called and status displayed

#### Scenario: Browser dismiss triggers refresh

- GIVEN seller returns from Stripe browser
- WHEN `WebBrowser.dismissBrowser` fires
- THEN refresh called and UI updated

### Requirement: Security Boundaries

Sellers access own account only. Stripe calls from Edge Functions only. `service_role` never reaches frontend. Admin views read-only except refresh.

#### Scenario: RLS blocks direct writes

- GIVEN frontend writes to `profiles_private`
- WHEN request reaches DB
- THEN RLS rejects (only `service_role` writes)

#### Scenario: Admin role from DB

- GIVEN user has admin in JWT only
- WHEN refresh checks authorization
- THEN function reads `role` from DB, rejects if not `admin`

### Requirement: Error Handling and Logging

The system MUST log Stripe API failures, webhook errors, and unrecognized deep links. Failed calls return cached status with error flag.

#### Scenario: Stripe API failure

- GIVEN Stripe returns 500 during refresh
- WHEN Edge Function catches error
- THEN cached status returned with error flag, frontend shows error

#### Scenario: Webhook failure logged

- GIVEN webhook handler fails on `account.updated`
- WHEN error occurs
- THEN event ID logged, non-200 returned for Stripe retry

### Requirement: DB Complete State Precedence

The system MUST treat DB onboarding status `complete` as the source of truth for frontend activation state after return, refresh, or later entry.

#### Scenario: Cached complete suppresses refresh failure

- GIVEN cached DB status is `complete`
- WHEN a Stripe refresh fails or returns an error flag
- THEN the frontend keeps the seller in activated success state
- AND no blocking refresh error is shown

#### Scenario: Complete beats return parameters

- GIVEN the seller opens onboarding with Stripe return params
- WHEN DB status resolves to `complete`
- THEN the UI shows success regardless of return/loading indicators

### Requirement: Frontend Return State Resolution

Onboarding UI MUST resolve Stripe return and refresh outcomes through the same status precedence rules. UI MUST show loading or pending guidance only while status is not `complete`; DB `complete` MUST resolve to success.

#### Scenario: Return resolves to final pending state

- GIVEN refresh completes with non-complete status
- WHEN the seller returns from Stripe
- THEN the frontend shows final-step pending/review guidance

### Requirement: Frontend Error Visibility

The frontend MUST surface onboarding refresh/status errors only when status is non-complete and the message is actionable.

#### Scenario: Non-complete refresh failure

- GIVEN cached status is `pending`
- WHEN refresh returns an error flag
- THEN the frontend may show an actionable refresh error

#### Scenario: Complete status hides refresh error

- GIVEN cached status is `complete`
- WHEN refresh returns an error flag
- THEN the frontend shows activated success
- AND no blocking error banner is visible
