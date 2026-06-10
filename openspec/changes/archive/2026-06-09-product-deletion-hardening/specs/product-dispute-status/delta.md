# Product Dispute Status Specification

## Purpose

Introduce the `IN_DISPUTE` product status so listings involved in an open dispute cannot be deleted and are visually flagged. The status is set automatically by a DB trigger on `disputes` INSERT and drives badge, smart navigation, and delete-button visibility in the mobile app.

## Requirements

### REQ-PDS-001: `IN_DISPUTE` Enum Value

`product_status_enum` SHALL include `'IN_DISPUTE'` via a forward-only `ALTER TYPE ... ADD VALUE`. No existing values SHALL be renamed or removed. After regeneration, `packages/types/src/database.types.ts` SHALL export `IN_DISPUTE` as a valid `ProductStatus`.

#### Scenario: Type system accepts IN_DISPUTE

- GIVEN the migration has run and types regenerated
- WHEN a TS file declares `const s: ProductStatus = 'IN_DISPUTE'`
- THEN compilation succeeds

#### Scenario: Prior enum values preserved

- GIVEN the prior enum values
- WHEN the migration runs
- THEN all prior values remain valid; only IN_DISPUTE is added

### REQ-PDS-002: Auto-Set Trigger on Dispute Open

A trigger `fn_set_product_in_dispute` SHALL fire `AFTER INSERT` on `disputes` and set the related product's `status = 'IN_DISPUTE'`. The function SHALL be `SECURITY INVOKER`. The update SHALL be idempotent — re-inserting for the same product SHALL NOT change the status again. The trigger SHALL skip products where `status IN ('SOLD', 'RESERVED')` (these are sales-locked and must not be downgraded). `VERIFIED` products SHALL transition to `IN_DISPUTE` when disputed. Soft-deleted products (`deleted_at IS NOT NULL`) SHALL be untouched.

#### Scenario: Dispute insert flips product status

- GIVEN `P.status = 'VERIFIED'`, `deleted_at IS NULL`
- WHEN a `disputes` row is inserted linking a shipment for `P`
- THEN `P.status = 'IN_DISPUTE'`

#### Scenario: Soft-deleted product is untouched

- GIVEN `P.deleted_at IS NOT NULL`
- WHEN a dispute row is inserted
- THEN `P.status` is NOT modified

### REQ-PDS-003: `IN_DISPUTE` Badge Rendering

`MyListingCard` SHALL render a visible IN_DISPUTE badge (icon + localized label) when `product.status === 'IN_DISPUTE'`, using the existing colored-dot + caption pattern. The badge SHALL sit before the action bar; the card SHALL remain tappable.

#### Scenario: Badge appears for disputed product

- GIVEN `product.status = 'IN_DISPUTE'`
- WHEN MyListingCard renders
- THEN the badge is visible with a warning color token and the localized text `profile:listings.status.IN_DISPUTE`

#### Scenario: No badge for non-disputed product

- GIVEN `product.status = 'VERIFIED'`
- WHEN MyListingCard renders
- THEN no dispute badge is rendered

### REQ-PDS-004: Smart Navigation to Order Detail

When the user taps a `MyListingCard` with `status === 'IN_DISPUTE'`, the card SHALL navigate to `/profile/orders/{order_id}` for the relevant order. If no related order id is derivable, it SHALL fall back to `/product/{id}` and the badge SHALL remain visible.

#### Scenario: Tap on disputed card opens order

- GIVEN `P` is `IN_DISPUTE` and linked to order `O`
- WHEN the user taps the card
- THEN the router pushes `/profile/orders/O`

#### Scenario: Fallback to product detail

- GIVEN `P` is `IN_DISPUTE` and no order id is available
- WHEN the user taps
- THEN the router pushes `/product/P.id` and the badge stays visible

### REQ-PDS-005: Hidden Delete Button for `IN_DISPUTE`

`MyListingCard` SHALL NOT render the trash `IconButton` when `product.status === 'IN_DISPUTE'`. The primary action button SHALL still render (verify / edit / fix) so the seller retains inspection access.

#### Scenario: Delete hidden for disputed product

- GIVEN `product.status = 'IN_DISPUTE'`
- WHEN MyListingCard renders
- THEN the trash icon is NOT in the DOM; the action bar contains only the primary action

#### Scenario: Delete visible for verified product

- GIVEN `product.status = 'VERIFIED'`
- WHEN MyListingCard renders
- THEN the trash icon is rendered
