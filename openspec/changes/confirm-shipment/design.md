# Design: Hardened Buyer Shipment Confirmation

## Technical Approach

Buyer and scheduled completion use one service-role-only RPC. Each Edge Function authenticates before calling it; the RPC locks and revalidates one shipment, writes audit evidence, and lets the existing trigger derive order status. Tracking ingestion and Connect payout release remain unchanged.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Edge / direct RPC | Extra deploy / smaller attack surface | Use `confirm-shipment-delivery`; revoke client RPC execution |
| Shared RPC / two writers | Strict source validation / no divergent races | Make `fn_confirm_shipment_delivery` canonical for buyer and auto |
| Logs / ledger | One table / constrained provenance | Add append-only `shipment_completion_events`, unique per shipment |
| Remove / preserve legacy accounting | Deprecated code / avoids stranded balances | Connect skips wallets; non-Connect preserves atomic wallet release |

## Data Flow

```text
Buyer → confirm Edge (JWT, maintenance, ownership) ─┐
Cron → auto Edge (secret, due IDs ≤100) ───────────┴→ RPC → row lock → audit + shipment update
                                                               └→ existing order trigger → payout view
```

Allowed transitions are `delivered → completed` by buyer immediately, or by auto when `delivered_at <= now()-48h`, still `delivered`, unconfirmed, and dispute-free. Under `FOR UPDATE`, the winner inserts the unique audit and updates status. A loser finding `completed` plus audit returns idempotent success with the winning source; `completed` without audit returns `COMPLETION_AUDIT_MISSING`. Buyer sets `buyer_confirmed_at`; auto never does.

## File Changes

| File | Action | Description |
|---|---|---|
| `supabase/migrations/<timestamp>_confirm_shipment_hardening.sql` | Create | CLI-generated migration path for the column, ledger, due index, RPC/grants, and legacy drop; the timestamp is assigned only when the migration is created. |
| `supabase/queries/orders/fn_confirm_shipment_delivery.sql` | Modify | Canonical transaction body |
| `supabase/queries/orders/fn_confirm_delivery.sql` | Delete | Retire order-level mutation |
| `supabase/functions/confirm-shipment-delivery/index.ts`, `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.ts`, `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` | Create | Buyer boundary, Zod plan, RED tests |
| `supabase/functions/complete-delivered-shipments/index.ts`, `supabase/functions/complete-delivered-shipments/complete-delivered-shipments.ts`, `supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts` | Create | Bounded scheduled caller and tests |
| `supabase/migrations/__tests__/confirm_shipment_hardening.test.ts` | Create | SQL/security/source guards |
| `packages/types/src/index.ts`, `packages/types/src/database.types.ts`, `packages/types/src/confirmShipmentContracts.test.ts` | Modify/Create | Registry, generated schema, contracts |
| `apps/frontend/core/hooks/useOrderActions.ts`, `apps/frontend/core/hooks/useShipments.ts`, `apps/frontend/core/hooks/useOrders.ts`; `apps/frontend/core/utils/shipment-confirmation.ts` | Modify/Create | Edge call, gate, errors |
| `apps/frontend/app/profile/orders/[id].tsx`; `apps/frontend/core/i18n/locales/en/orders.json`, `apps/frontend/core/i18n/locales/es/orders.json`; `apps/frontend/tests/orders/shipment-confirmation.test.ts` | Modify/Create | Required shipment, honest copy, RED tests |
| `openspec/changes/confirm-shipment/deployment-handoff.md` | Create | Manual release checklist |

## Interfaces / Contracts

`confirm-shipment-delivery` uses strict Zod `safeParse` for UUIDs `{orderId,shipmentId,idempotencyKey}`; the key must be `confirm_shipment_<shipmentId>`. Success is `{success:true,shipmentId,status:"completed",completionSource:"buyer"|"auto",idempotent}`; failures are `{success:false,error}`. Codes/statuses: `INVALID_REQUEST` 400, `AUTH_REQUIRED` 401, `BUYER_REQUIRED` 403, `SHIPMENT_NOT_FOUND` 404, state/order/dispute/audit conflicts 409, `MAINTENANCE_MODE` 503, `INTERNAL_ERROR` 500.

The RPC `(p_shipment_id uuid,p_source text,p_actor_id uuid,p_idempotency_key text)` is `SECURITY DEFINER SET search_path=''`, fully qualified, checks the service-role claim, repeats buyer/order ownership, and grants only `service_role` after revoking `PUBLIC, anon, authenticated`. `shipment_completion_events(id,shipment_id UNIQUE FK,order_id,source,actor_id,idempotency_key UNIQUE,completed_at,is_connect,created_at)` constrains `buyer`/actor and `auto`/NULL pairing; RLS and revoked client writes make it append-only. Auto keys are `auto_completion_<shipmentId>`. Connect also emits secret-free `system_logs` INFO. Edge logs include shipment, source, key, result/count, and code only.

## Testing Strategy

Strict TDD starts with failing helper/Zod/auth/gate/error/contract tests and SQL assertions for grants, search path, wallet guard, ledger, legacy drop, and due index. A manually migrated Supabase test project (no Docker) proves wrong buyer/state/dispute rejection, Connect zero-wallet writes, legacy accounting, order derivation, payout visibility, 47h59m exclusion, 48h inclusion, retries, and concurrent buyer/auto calls yielding one completion/audit.

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior | Planned RED tests |
|---|---|---|---|
| Cron process integration | Applicable | Exact secret before DB work; invalid method/secret fails; batch is bounded and retry-safe | auth-before-effects, limit, partial-failure, retry tests |
| Documentation-like paths | N/A — no file classification/execution | None | None |
| Git repository selection | N/A — no VCS automation | None | None |
| Commit state | N/A — no commit automation | None | None |
| Push state | N/A — no push automation | None | None |
| PR commands | N/A — no PR automation | None | None |

## Migration / Rollout

Apply migration; deploy functions; create Edge/Vault secrets and a Dashboard-managed five-minute `pg_cron`/`pg_net` call using Vault-held anon JWT plus `x-cron-secret` (never service role); enable schedule; deploy frontend; run `bun db:types` only after SQL confirmation. Sandbox/manual checks verify gateway JWT acceptance, Envia timestamps, and unchanged Stripe queue behavior. Roll back by unscheduling first and reverting frontend/functions/RPC; retain nullable column/audit rows. Legacy restoration is emergency-only.

## Open Questions

None. Provider and gateway behavior require bounded sandbox/manual validation, not product decisions.
