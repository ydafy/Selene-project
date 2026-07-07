# Stripe Onboarding UI Specification

## Purpose

Define the seller-facing Stripe Connect onboarding screen, including guided steps, Stripe return outcomes, activated state, and localized copy.

## Requirements

### Requirement: Activated Completion View

The system MUST render an activated success view whenever the seller onboarding status is `complete`.

#### Scenario: Complete seller enters onboarding

- GIVEN the DB status is `complete`
- WHEN the seller opens the onboarding screen
- THEN the screen shows an activated success state
- AND it shows a CTA to continue selling or create/manage listings

#### Scenario: Complete status beats transient UI state

- GIVEN status is `complete` and loading, return params, or refresh errors exist
- WHEN the onboarding UI resolves visible state
- THEN success is shown instead of wizard, pending, or blocking error content

### Requirement: Hosted Return Outcome

The system MUST route sellers returning from Stripe to success when status is complete, otherwise to the final `Done/Listo` step with non-blocking guidance.

#### Scenario: Return after completed onboarding

- GIVEN Stripe redirects back with onboarding return params
- WHEN refreshed or cached DB status is `complete`
- THEN the seller sees the activated success view

#### Scenario: Return before completion

- GIVEN Stripe redirects back and status is `pending`, `rejected`, or not started
- WHEN the onboarding screen renders
- THEN the seller remains on the final step
- AND guidance explains the status and next action without blocking navigation

### Requirement: Final-Step Pending Guidance

The system MUST keep non-complete sellers in the guided stepper and place pending/not-started state on the final `Done/Listo` step.

#### Scenario: Not-started seller reaches final step

- GIVEN the seller has not started Stripe onboarding
- WHEN they reach `Done/Listo`
- THEN the primary CTA starts Stripe onboarding

#### Scenario: Pending seller reaches final step

- GIVEN status is `pending`
- WHEN the final step is visible
- THEN the primary CTA continues Stripe onboarding
- AND the guidance is informational, not a blocking failure

### Requirement: Onboarding Copy Localization

The system MUST provide English and Spanish translations for every new or changed onboarding string.

#### Scenario: Locale parity

- GIVEN a new onboarding title, CTA, guidance, or error key is added
- WHEN locales are checked
- THEN matching keys exist in English and Spanish

#### Scenario: No inline user-facing fallback

- GIVEN the onboarding UI renders text
- WHEN the text is user-facing
- THEN it resolves through i18n keys, not hardcoded component strings
