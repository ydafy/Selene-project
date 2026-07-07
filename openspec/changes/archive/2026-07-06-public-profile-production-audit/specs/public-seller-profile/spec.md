# Public Seller Profile Specification

## Purpose

Define production-safe public seller profile behavior for trust signals, visibility, resilience, and review presentation.

## Requirements

### Requirement: Public Route Guard and Privacy Boundary

The system MUST validate `profile/[id]` route params before data reads. The system MUST read only public profile data sources and MUST NOT expose private profile fields.

#### Scenario: Valid public profile route

- GIVEN a valid scalar seller id in the route
- WHEN the public profile loads
- THEN only public profile, public listings, and seller reviews are queried

#### Scenario: Invalid route param

- GIVEN a missing, empty, or array-valued seller id
- WHEN the public profile loads
- THEN the screen shows an explicit retryable error state and does not query generic catalog data

### Requirement: Public Listings and Screen Resilience

The system MUST show only listings that are both active and verified on public seller profiles. The system MUST distinguish empty states from fetch failures and SHALL provide retry affordances for products and reviews failures.

#### Scenario: Public listings visibility

- GIVEN a seller with active-verified, sold, and unverified products
- WHEN a visitor opens the public profile products tab
- THEN only active-verified listings are visible

#### Scenario: Query failure behavior

- GIVEN products or reviews queries fail
- WHEN the public profile renders
- THEN the UI shows an explicit error state with retry, not an empty-state message

### Requirement: Seller Review Display Semantics

The system MUST read public reviews by `seller_id`. Verified-purchase badges MUST require valid `shipment_id` and `product_id` linkage. Legacy reviews without valid linkage MUST remain visible without verified badges. Rating-only reviews with empty comments MUST contribute to aggregates and MUST NOT render review cards. If `reviews.created_at` exists, review cards MUST display a localized review date. The public review list MUST NOT add filtering or sorting behavior in this change.

#### Scenario: Mixed historical review data

- GIVEN linked reviews and legacy unlinked reviews for the same seller
- WHEN reviews are rendered on the public profile
- THEN only linked reviews show verified-purchase badges and legacy reviews remain visible without badge

#### Scenario: Rating-only review

- GIVEN a review row with rating and empty comment
- WHEN the public profile computes aggregates and list cards
- THEN the rating affects seller aggregate stats and no review card is rendered

### Requirement: Owner Actions, Accessibility, and Localization

The system MUST hide report/block moderation actions when the profile owner views their own public profile. Interactive elements SHALL expose accessible roles/labels. Public profile UI copy MUST use localization keys.

#### Scenario: Owner view action policy

- GIVEN the authenticated user is viewing their own public profile route
- WHEN header actions are rendered
- THEN report/block actions are not shown

#### Scenario: Accessibility and i18n compliance

- GIVEN segmented controls, seller CTAs, and review/listing cards are rendered
- WHEN assistive technologies and locale translation lookup are applied
- THEN controls expose accessible semantics and displayed copy resolves through localization keys
