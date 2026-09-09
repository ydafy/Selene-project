# Archive Report: standardize-checkout-deterministic-uuids

## Change Summary

**Change**: `standardize-checkout-deterministic-uuids`
**Archived**: 2026-09-05
**Verdict**: PASS WITH WARNINGS
**Evidence revision**: `sha256:08652fc66edce72a374726d02be47a35eda107f40a8071fc761441a5635d6046`

## Final-State Facts (at archive close)

True RFC 9562 namespace-based UUID v5 implementation is complete. Order-group and shipment IDs are derived from a fixed namespace UUID (`7b0f4a20-5c30-4e0f-8f84-9a9f4b2e19c1`) using canonical names `selene_order_group:${idempotencyKey}` and `selene_shipment:${idempotencyKey}:product:${productId}`. The `deriveOrderGroupId` and `deriveShipmentId` functions now produce true UUID v5 (version nibble `5`, RFC 4122 variant bits), replacing the prior raw SHA-256 digest formatter.

## Verification Summary

- **Requirements**: 4/4 compliant
- **Scenarios**: 8/8 compliant
- **Focused test suites**: 123 pass, 0 fail (UUID, cutover, confirmation, settlement, recovery)
- **SQL/wiring suites**: 55 pass, 0 fail
- **Corrected allocation wiring test**: 1 pass
- **ESLint**: Focused pass, no findings
- **Deno check (no-config)**: Source check passed on producer module
- **Full `bun test`**: 977 pass, 11 fail, 16 errors — all attributed to unrelated baseline/environment conditions; no failure exercises change-owned files

## Warnings (baseline/environment, not change-caused)

1. Full `bun test` exits 1 with 11 failures and 16 errors from unrelated dirty-worktree behavior and missing local dependencies.
2. Configured `deno check` cannot resolve local Node type package; changed pure module passes when checked without repo config.
3. Deno formatting differs in producer files; Deno lint reports four existing inline-import-prefix findings in the read-only entrypoint.
4. Remote sandbox smoke remains pending and maintainer-owned by contract.

## Cutover Status

Remote deployment, SQL execution, `bun db:types`, commit, and push have NOT occurred. The cutover runbook (`cutover-runbook.md`) is the operational handoff. Maintainer must execute sandbox cutover: deploy `create-connect-payment`, run `reset-prelaunch-order-test-data.sql`, and use fresh idempotency keys.

## Spec Sync

| Domain | Action | Details |
|--------|--------|---------|
| single-modal-multiseller-checkout | Updated | 1 modified requirement (Durable Per-Product Shipment Allocation), 3 added requirements (Deterministic Checkout Identity, Producer-to-Consumer Identifier Acceptance, Identifier Compatibility and Cutover Contract), 5 new acceptance criteria |

## Archive Contents

- proposal.md ✅
- specs/single-modal-multiseller-checkout/spec.md ✅
- design.md ✅
- tasks.md ✅ (19/19 tasks complete)
- verify-report.md ✅
- apply-progress.md ✅
- exploration.md ✅
- cutover-runbook.md ✅

## Source of Truth Updated

- `openspec/specs/single-modal-multiseller-checkout/spec.md` — now reflects UUID v5 shipment IDs, deterministic checkout identity, producer-to-consumer acceptance, and cutover contract requirements.

## Final-State Authority Notes

- Per the orchestrator's mandatory final-state handoff, all warnings are baseline/environment conditions unrelated to this change.
- The cutover runbook is the operational handoff; remote deployment is not marked complete.
- No CRITICAL issues exist in the verify report.
- The archived `tasks.md` has no unchecked implementation tasks.

## Key Learnings

1. Git mv fails on directories containing untracked files; plain mv with byte-level hash readback is a safe fallback.
2. PowerShell's Compare-Object diff cmdlet compares directory entries, not file contents — use Get-FileHash for byte-identity verification.
3. UUID v5 namespace contracts are externally significant compatibility boundaries that require explicit breaking migration procedures.
