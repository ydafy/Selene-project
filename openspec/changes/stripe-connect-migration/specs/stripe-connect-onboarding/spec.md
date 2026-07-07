# Delta for Stripe Connect Onboarding

## ADDED Requirements

### Requirement: CON-001 — Seller Connect Onboarding

The system MUST provide a Stripe Connect Express onboarding flow using Accounts v2 (`POST /v2/core/accounts`) with controller properties: `losses.payments: 'stripe'`, `fees.payer: 'application'`, `stripe_dashboard.type: 'full'`, `requirement_collection: 'stripe'`. Onboarding status MUST be tracked in `profiles_private.stripe_account_id` and `profiles_private.stripe_onboarding_status` (enum: `pending`, `complete`, `rejected`).

#### Scenario: First-time seller initiates onboarding

- GIVEN a seller with no `stripe_account_id` generates their first shipping label
- WHEN the seller accesses the onboarding screen
- THEN the system calls `create-connect-account` edge function and redirects to Stripe-hosted AccountLink

#### Scenario: Stripe confirms KYC completion

- GIVEN a seller with `stripe_onboarding_status = 'pending'`
- WHEN Stripe sends `account.updated` webhook with `charges_enabled = true`
- THEN the system sets `stripe_onboarding_status = 'complete'` and stores `stripe_account_id`

#### Scenario: Seller onboarding rejected by Stripe

- GIVEN a seller with `stripe_onboarding_status = 'pending'`
- WHEN Stripe sends `account.updated` webhook with rejection or `charges_enabled = false` after requirements deadline
- THEN the system sets `stripe_onboarding_status = 'rejected'` and blocks shipping label generation

#### Scenario: Onboarding gate at label generation

- GIVEN a seller with `stripe_onboarding_status != 'complete'`
- WHEN the seller attempts to generate a shipping label for a paid shipment
- THEN the system blocks label generation and redirects to onboarding screen

### Requirement: CON-010 — Admin Onboarding Tracking

The system MUST provide an admin dashboard view showing all sellers' Connect onboarding status, `stripe_account_id`, and `charges_enabled` flag.

#### Scenario: Admin views seller onboarding status

- GIVEN an authenticated admin accesses the SellerOnboardingPage
- WHEN the page loads
- THEN it displays a table of sellers with `stripe_onboarding_status`, `stripe_account_id`, and `charges_enabled`
