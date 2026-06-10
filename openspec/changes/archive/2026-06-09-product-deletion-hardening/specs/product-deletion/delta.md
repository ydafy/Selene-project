# Product Deletion Specification

## Purpose

Secure, correct, accessible soft-delete flow for seller products. Covers DB RLS, ownership + pre-flight checks, optimistic UI with rollback, confirm dialog a11y, haptics, and two bug fixes (PostgREST filter, admin reactivation).

## Requirements

### REQ-PD-001: RLS on `products`

The system SHALL enable RLS on `products`. `anon` MAY SELECT only. `authenticated` MAY UPDATE only their own products (`seller_id = auth.uid()`) and only while `deleted_at IS NULL`. service_role bypasses RLS for Edge Functions.

#### Scenario: Owner soft-deletes own product

- GIVEN seller `A` owns `P`, `deleted_at IS NULL`
- WHEN A sets `deleted_at = now()`, `status = 'HIDDEN'`
- THEN 1 row is updated

#### Scenario: Non-owner writes affect 0 rows

- GIVEN user `B` ≠ owner of `P`
- WHEN B attempts UPDATE on `P`
- THEN 0 rows change

### REQ-PD-002: Ownership + Pre-flight Validation

The delete mutation SHALL reject (no network call) when seller_id ≠ currentUser.id, when an open dispute references the product, or when status ∈ {SOLD, RESERVED}. Rejection SHALL surface a localized toast.

#### Scenario: Active dispute blocks delete

- GIVEN an open `disputes` row references `P`
- WHEN delete is triggered
- THEN no Supabase call is made and a localized toast appears

#### Scenario: SOLD product blocked

- GIVEN `P.status = 'SOLD'`
- WHEN delete is triggered
- THEN the mutation is aborted and a localized toast appears

### REQ-PD-003: Optimistic Update with Rollback

The mutation SHALL remove the product from `['my-listings']` and `['products']` caches in `onMutate`, restore on `onError`, and reconcile via `invalidateQueries` on `onSuccess`. `expo-haptics notificationAsync('success')` SHALL fire on iOS success.

#### Scenario: Successful delete is instant

- GIVEN listings cache contains `P`
- WHEN the user confirms
- THEN `P` is removed immediately, the success haptic plays, the network call runs

#### Scenario: Network failure restores cache

- GIVEN the optimistic removal has been applied
- WHEN Supabase rejects
- THEN `P` reappears in the list and an error toast is shown

### REQ-PD-004: `useRecentlyViewed` PostgREST Filter Fix

The PostgREST filter in `useRecentlyViewed` SHALL use CSV syntax without inner quotes: `.not('status', 'in', '(HIDDEN,REJECTED)')`.

#### Scenario: HIDDEN product excluded

- GIVEN `viewedIds` includes `H` (HIDDEN) and `V` (VERIFIED)
- WHEN the hook runs
- THEN only `V` is returned

### REQ-PD-005: Admin Reactivation Respects Soft-Delete

`fn_admin_update_user_status` reactivation branch SHALL restore only products with `status = 'HIDDEN' AND deleted_at IS NULL`. Soft-deleted products SHALL stay hidden.

#### Scenario: Soft-deleted product stays hidden

- GIVEN `P.status = 'HIDDEN'`, `deleted_at = '2026-06-01'`
- WHEN the admin reactivates the seller
- THEN `P` is NOT updated to `VERIFIED`

#### Scenario: HIDDEN-but-not-deleted is restored

- GIVEN `P.status = 'HIDDEN'`, `deleted_at IS NULL`
- WHEN the admin reactivates
- THEN `P.status = 'VERIFIED'`

### REQ-PD-006: `MyListingCard` Accessibility + Theme Tokens

`MyListingCard` SHALL expose `accessibilityRole="button"`, `accessibilityLabel`, and `accessibilityHint` on the card and the delete button. The delete button SHALL set `accessibilityState.disabled = true` and show a spinner while `isDeleting`. All raw shadow/color literals SHALL be replaced with Restyle tokens.

#### Scenario: Screen reader announces card and delete

- GIVEN VoiceOver is active
- WHEN focus lands on the card
- THEN the card reads "{name}, {price}" and the trash button reads "Delete listing" with a hint

#### Scenario: Delete disabled during mutation

- GIVEN `isDeleting` is `true`
- WHEN the user taps delete
- THEN the press is ignored, the button is `aria-disabled`, a spinner is shown

### REQ-PD-007: `ConfirmDialog` Focus Trap + Live Region

`ConfirmDialog` SHALL trap focus while visible, move focus to confirm on open, restore focus to the trigger on close, and announce open/close via `aria-live="polite"`. The `loading` prop SHALL swap the confirm label and disable backdrop dismiss.

#### Scenario: Tab cycles within dialog

- GIVEN focus is on the confirm button
- WHEN the user presses Tab
- THEN focus moves to cancel; Shift+Tab returns to confirm (trapped)

#### Scenario: Close restores focus

- GIVEN the dialog closes (cancel or backdrop)
- THEN focus is returned to the trigger element
