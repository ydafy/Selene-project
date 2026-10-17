# Order summary clarity

## Objective and scope
Clarify only the monetary overview of the order summary and fix loading/error handling on that screen. Buyer sees saved product subtotal and persisted total paid; seller sees only visible product subtotal, never earnings. Do not add a fee row or recalculate historical fees.

## Constraints
No shipment-card edits, backend, checkout, historical-price changes, cancellations or disputes. Preserve existing uncommitted changes, especially en/es orders.json and i18nOrdersParity.test.ts. User now explicitly requests simple commit, push and merge without PR. Stage only this feature's hunks and files; preserve unrelated work. Start from main and use a short feature branch before integrating back to main.

## Tasks
- [x] T1 (done; commit 84fd27aa7797c8cddd4efb222bd1ba0d28ef7321): Implement scoped summary amounts and terminal loading/error/absent-order handling with test-first evidence and matching EN/ES labels. Preserve cached-data refresh behavior and role visibility.
- [x] T2 (done, scoped checks): Independently verify focused tests, scoped ESLint and diff review; recheck helper relocation.
- [ ] T3 (in_progress; deferred outside-scope verification): Global TypeScript check remains failed outside candidate files, baseline unknown; no unrelated fixes authorized. User confirmed visual result looks good.
- [x] T4 (done): Commit 84fd27aa7797c8cddd4efb222bd1ba0d28ef7321 (`fix(orders): clarify summary totals and loading`), fast-forward integrated into main and pushed to origin/main without PR. Only candidate hunks committed, unrelated changes preserved. Commit hooks ran 1677 tests: all passed. Native committed-range inspection isolated seven paths; host consent declined this candidate, no lineage created. Independent verification previously completed; no native approval claimed.

## Acceptance and checks
- Buyer subtotal is calculated from saved purchase prices in integer cents, total paid remains persisted order amount.
- Seller sees subtotal of only authorized visible products, without buyer total or seller net.
- Skeleton appears only for initial pending data, not indefinitely for terminal query failures or missing order. Errors have retry; no raw error disclosure.
- Shipment failure must not be silently displayed as a complete empty summary.
- Focused deterministic tests observe RED then GREEN; translation parity and relevant checks run.
- No unrelated design changes or configuration changes.

## Evidence
Writer implemented amounts, loading/error policy and EN/ES copy. Focused new tests observed RED (missing helper), then GREEN (7 passing). Related obsolete summary.total assertion updated to subtotal and totalPaid while preserving preexisting test edits; all 32 focused tests now pass. Global TypeScript check failed outside changed files; baseline not yet independently established. Scoped diff whitespace check passed. Native inspect is selection-blocked and currently projects unrelated tracked edits too; no review started.

## Next step
Independent verifier runs focused checks and inspects diff and TypeScript diagnostics. Native review cannot isolate existing unrelated tracked edits through currently offered inspect route; do not start a mixed-scope review without human decision. Independent checks observed 32 tests passing, scoped ESLint and diff --check passing; tsc outside-file failures baseline unknown. Candidate-added route risk corrected: helper relocated unchanged to core/utils/order-summary-state.ts and imports updated; writer reran all 32 focused tests, scoped ESLint and diff check successfully. Parent spot check repeated 32 tests (141 assertions) and confirmed old helper absent/new helper exists. Independent verifier found no other scoped behavior defect. No device/browser visual check observed yet.
