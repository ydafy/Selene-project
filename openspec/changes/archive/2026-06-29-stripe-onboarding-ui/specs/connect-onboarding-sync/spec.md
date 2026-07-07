# Delta for Connect Onboarding Sync

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Frontend Return State Resolution

Onboarding UI MUST resolve Stripe return and refresh outcomes through the same status precedence rules. UI MUST show loading or pending guidance only while status is not `complete`; DB `complete` MUST resolve to success.
(Previously: UI showed loading + correct status, without explicit complete-state precedence.)

#### Scenario: Return resolves to final pending state

- GIVEN refresh completes with non-complete status
- WHEN the seller returns from Stripe
- THEN the frontend shows final-step pending/review guidance

### Requirement: Frontend Error Visibility

The frontend MUST surface onboarding refresh/status errors only when status is non-complete and the message is actionable.
(Previously: failed refresh calls could leave a visible error even after a complete status existed.)

#### Scenario: Non-complete refresh failure

- GIVEN cached status is `pending`
- WHEN refresh returns an error flag
- THEN the frontend may show an actionable refresh error

#### Scenario: Complete status hides refresh error

- GIVEN cached status is `complete`
- WHEN refresh returns an error flag
- THEN the frontend shows activated success
- AND no blocking error banner is visible
