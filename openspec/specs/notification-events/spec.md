# In-app Notification Events Specification

## Scope and authority

This is the launch catalogue for persistent in-app notices, not a declaration that its future schema or producers are deployed. A trusted server transaction/RPC SHALL derive recipients and persist each notice atomically with its business transition; a server-credential Edge boundary SHALL first persist a durable event/outbox record in that same business transaction and retry its idempotent notice projection from that record. A standalone post-commit Edge insert without durable recovery is prohibited. Clients SHALL NOT insert business-event notices or supply recipients, amounts, verdicts, or event identities. Publication failures SHALL remain observable and retryable without duplicating an inbox row. Expo push and unconfirmed timeout, payout, generic tracking, and legacy cancellation alerts are outside this catalogue pending separate evidence. Do not assert a refund until its authoritative refund outcome is committed.

#### Scenario: Edge projection fails after business commit
- GIVEN a business transition and its durable event commit together
- WHEN the Edge notice projection fails
- THEN a retry uses that event's stable identity and creates at most one inbox row per recipient

## Stable identity and compatibility

Each approved transition has one stable `source_event_key`, composed from the catalogue event kind, authoritative aggregate ID, and a stable transition occurrence/revision ID when the same aggregate can transition more than once. A retry MUST reuse that key; do not derive it from request time, localized text, route, or a newly generated notification UUID. The uniqueness boundary is `(source_event_key, recipient_user_id)`; deduplicate seller IDs before insertion and suppress duplicate actor/recipient notices for the same event. Distinct transitions (including a genuinely new dispute verdict revision) retain distinct keys. N4 defines the actual storage and privileges; the generated `notifications` row currently has only `id`, `user_id`, `type`, `title`, `message`, `action_path`, `read`, `created_at`, and `deleted_at`, not a source key. Until migration and producer cutover, existing rows remain readable and owner-scoped, without retroactively assigning invented keys. New readers tolerate legacy nullable fields and unknown types with safe generic presentation and validated navigation; cutover must avoid double-writing the same business transition from old and new producers.

## Approved catalogue

| Event kind / authoritative boundary | Recipients (server-derived) | Destination / meaning |
| --- | --- | --- |
| `order.payment_confirmed` / one confirmed paid order | Buyer and each distinct seller across its shipments, one row each | `/profile/orders/{orderId}`; confirmed purchase or new sale, not per-item spam |
| `shipment.cancelled` / committed seller-scoped cancellation after financial prerequisites | Buyer and affected shipment seller only | `/profile/orders/{orderId}`; describe only confirmed cancellation/refund state |
| `dispute.opened` / committed dispute | Affected shipment buyer and seller, excluding redundant actor notice | `/profile/orders/{orderId}`; review dispute |
| `dispute.verdict` / committed final verdict revision | Affected buyer and seller, with role-appropriate result | `/profile/orders/{orderId}`; do not promise an unconfirmed refund |
| `product.approved` / APPROVE with no public note | Product seller | `/product/{productId}`; listing approved |
| `product.approved_with_note` / APPROVE with public seller-facing note | Product seller | `/product/{productId}`; approved with public note; never expose internal notes |
| `product.rejected` / REJECT | Product seller | `/verify/{productId}`; revision/action required, public rejection reason only |
| `return.seller_evidence_submitted` / committed material evidence submission | Affected buyer | `/profile/orders/{orderId}`; return evidence ready for review |
| `return.delivered` / committed return delivery transition | Affected buyer and seller when each has a meaningful next step | `/profile/orders/{orderId}`; delivery observed, not settlement promised |

For each row, verify the referenced order, shipment, dispute, or product and recipient relationship at the trusted boundary. Repeated callbacks and no-op state writes MUST NOT emit a new occurrence. `type` is legacy display severity, not an event identity or urgency signal. Consumer urgency/presentation derives from approved event kind and recipient role, not `action_path`, title, or localized message. Product, verification and order destinations are validated against actual registered routes before navigation; missing or malformed targets fall back to the inbox. This contract does not grant access to the destination resource by itself.
