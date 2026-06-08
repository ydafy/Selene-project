# Admin Dispute Notifications Specification

## Purpose

Ensure admin-web dispute resolution flows insert notifications for affected users with correct `user_id`, `action_path`, and `type` fields.

## Requirements

### Requirement: Dispute Verdict Notification Insertion

**ID**: CONF-012
**Priority**: P1

The system SHALL insert a notification record into the `notifications` table when an admin resolves a dispute verdict. The notification SHALL include: `user_id` (affected buyer or seller), `type` ('info', 'warning', or 'error' based on verdict), `action_path` (deep link to the disputed order/shipment), `title`, and `message`.

#### Scenario: Buyer-wins verdict notifies seller

- GIVEN an admin resolves a dispute with buyer-wins verdict
- WHEN the verdict is processed
- THEN a notification is inserted for the seller with `type: 'warning'` and `action_path` pointing to the order

#### Scenario: Seller-wins verdict notifies buyer

- GIVEN an admin resolves a dispute with seller-wins verdict
- WHEN the verdict is processed
- THEN a notification is inserted for the buyer with `type: 'info'` and `action_path` pointing to the order

#### Scenario: Notification includes correct deep link

- GIVEN a dispute is linked to `shipment_id` belonging to `order_id`
- WHEN the notification is inserted
- THEN `action_path` is `/profile/orders/{order_id}` — valid Expo Router route

#### Scenario: No duplicate notifications on re-verdict

- GIVEN a dispute is re-evaluated with the same verdict
- WHEN the verdict is processed again
- THEN a new notification is inserted — previous notification remains (audit trail preserved)

### Requirement: Existing Product Notification Pattern Reused

The admin-web SHALL use the existing `supabase.from('notifications').insert(...)` pattern for dispute notifications, matching the pattern already used for product verification notifications.

#### Scenario: Insert pattern matches product notifications

- GIVEN the codebase has a working product notification insert
- WHEN dispute notification code is written
- THEN it uses the same `supabase.from('notifications').insert()` call structure — consistent pattern
