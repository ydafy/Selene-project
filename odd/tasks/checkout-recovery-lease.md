# Checkout recovery worker: expiring lease (BL13)
Replace the global boolean `system_settings.checkout_recovery_running` with an expiring, holder-only lease, the pattern of `fn_acquire_auto_cancel_lease`.
Branch: `fix/checkout-recovery-lease`. Worktree: `C:/dev/School-portal-worktrees/checkout-recovery-lease`.

## Specs
S1. "el lock checkout_recovery_running del checkout-recovery-worker puede quedar trabado para siempre; evaluar el patrón de lease que expira (como fn_acquire_auto_cancel_lease)."
S2. Backlog BL13: "If that flag is a boolean lock like the old auto-cancel ones, a killed run leaves the worker skipping forever; check its runs and consider the expiring-lease pattern of `fn_acquire_auto_cancel_lease`."
S3. "test primero (RED, después GREEN); probalo en el stack local (Bruno o webhook firmado si toca Edge Functions); RDD assess; commit propio si toca plata, SQL o permisos"
S4. "Marcá el ítem DONE en el backlog, con evidencia, en el mismo PR."

## Tasks
- T1 | S1-S3 | inline | SQL: `fn_acquire_checkout_recovery_lease()` / `fn_release_checkout_recovery_lease(uuid)`, service-only, TTL 600 s, acquire only while `checkout_recovery_enabled`; live harness `scripts/test-checkout-recovery-lease.ts`; Bruno per role. Own commit.
- T2 | S1, S3 | inline | Worker acquires the lease, releases it in `finally` without throwing (an unreleased lease expires). Commit.
- T3 | S1 | inline | Drop `checkout_recovery_running` (apply after T2 is deployed), seed and seed test. Commit with regenerated types.
- T4 | S4 | inline | Production handoff, verification, backlog DONE, PR.

## Log
- L1 — User request (2026-10-25): "Trabajá solo BL13 de odd/tasks/cross-module-backlog.md: el lock checkout_recovery_running del checkout-recovery-worker puede quedar trabado para siempre; evaluar el patrón de lease que expira (como fn_acquire_auto_cancel_lease). [...] test primero (RED, después GREEN); probalo en el stack local (Bruno o webhook firmado si toca Edge Functions); RDD assess; commit propio si toca plata, SQL o permisos; PR, CI y merge; borrá el worktree. Marcá el ítem DONE en el backlog, con evidencia, en el mismo PR."
- L2 — Confirmed on the remote project (Supabase MCP, 2026-10-26 ~00:30 UTC): `checkout_recovery_enabled = true`, `checkout_recovery_running = true` (row `updated_at` 2026-04-24), job `checkout-recovery-worker-every-5-minutes` (`*/5`) active, and every response in `net._http_response` retention is 200 `{"received":true,"skipped":true}` (72). So the worker has not processed anything since the flag stuck. No work is waiting today: 0 orders with `payment_processing = true`, 0 `checkout_recovery_shells`. No open PR or worktree touches it; not fixed on `main` (5cd0902).
- L3 — Same boolean-lock pattern in `release-funds` (`release_funds_running`) and `return-delivery-timeout` (`return_delivery_timeout_running`); both `false` on the remote today. Out of scope: reported as a Finding issue.
