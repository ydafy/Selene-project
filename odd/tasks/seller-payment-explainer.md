# Seller payment explainer

## Objective
Give sellers a concise, shared explanation of payment stages without claiming live payout status or guaranteed dates.

## Problem and rationale
Connect onboarding currently explains registration but not payment release. Completed shipments do not explain the remaining wait. Reuse one explanation in both contexts to prevent drift.

## Scope
- Shared mobile informational component, not a wallet or payout tracker.
- Connect onboarding success screen: persistent explanation; preserve all other account states/actions.
- Seller completed, dispute-free shipment: localized help button and dismissible informational modal.
- English/Spanish copy and narrowly related deterministic tests.
- No backend, schema, account settings, payment mutations or legacy-wallet cleanup.

## Approved content
1. Buyer reviews after delivery and may confirm early; eligible shipments auto-complete after 48 hours if no problem is reported.
2. Selene reviews eligible completed payments daily to manage release; completion is not a bank deposit.
3. Bank deposit normally takes 1-4 business days AFTER initiation, not after completion or purchase.
4. Stripe initial waiting periods, unavailable funds or additional information may cause delays; do not assign a fixed first-sale wait or pretend to know this shipment's payout state.
5. Replace connected-success deposit-schedule wording with wording consistent with Selene-managed release.

## Constraints
- User explicitly requests one feature commit and push directly to main; no feature branch or PR.
- Current main is 84fd27a after the maintainer's scoped summary commit; preserve untracked .pi/gentle-ai/profile.json and unrelated modified odd/tasks/order-summary-clarity.md.
- Same-tree writer finished again (user confirmation). No parallel writers.
- Human declined native review for this feature; one answer-consent attempt failed preflight because concurrent untracked inventory changed, with no authority or mutation. Do not reprompt. Assessment is unassessable (untracked declaration), so independent verification is required and provided.
- Known baseline frontend compiler debt exists; do not fix unrelated diagnostics or tooling config.

## Tasks
- [x] T1 (done): Implement shared explanation and both entry points, verify behavior/copy/UI, and record one scoped work-unit commit on main.

## Acceptance and checks
- One content source and translation subtree for inline and modal presentation.
- Help only for the selected seller shipment with status completed and no dispute; never from timer expiry, buyer or order-level status.
- Modal fits screen, scrolls if needed and dismisses without mutations.
- Onboarding registration/pending/rejected/loading/auth-required flows stay unchanged.
- EN/ES parity, correct bank-time origin, no payout guarantee or numeric first-sale claim.
- Test-first for applicable deterministic rendering/source/copy guards; focused Bun checks, baseline-aware type check when applicable.
- Actual Android emulator checks of completed seller modal and connected Payments success screen; report unavailable states honestly without changing backend fixtures.
- Native review if available/consented and normal repo commit hooks; no forced push or hook bypass.

## Progress
Implemented shared content and both UI entry points in 10 frontend component/locale/test paths. Worker test-first evidence: 25 passed and 5 intended failures before implementation; then 30 passed and 0 failed. Final independent focused checks against main 84fd27a: 30 passed, 0 failed, 191 assertions; git diff --check passed. Spanish Android completed-seller modal renders/scrolls and dismisses via Close, Back and backdrop; connected Payments renders the same content, delay footnote and existing CTA. Screenshots: C:/Users/estra/AppData/Local/Temp/selene-explainer-{modal-top,modal-bottom,close,back,backdrop,onboarding-top,onboarding-bottom}.png. Help label subsequently aligned to approved wording, with no layout/logic change; final label not separately checked visually. English runtime, dynamic text scaling, alternative account/shipment fixtures and accessibility semantics remain unverified. Compiler not run (known baseline debt). Normal commit hooks passed all 1677 tests, 0 failures, 5829 assertions across 186 files. Scope preserved the separately committed summary work and excludes its pending tracking document/profile. Native review declined; no authority created. No payment/backend/schema behavior changed.

## Work-unit identity
Conventional Commit: feat(payments): explain seller payout stages, parent 84fd27a, main. Initial verified source commit: ea51dd9. This document is finalized into that same local work unit before its first push; the final published SHA and push result are recorded in the Engram mirror and delivery summary, avoiding a separate bookkeeping commit.

## Rollback
Remove the shared explainer and its two UI entry points/translation keys/test guards; preserve existing onboarding, shipment state and all financial logic.

## Next step
Finalize this tracking document into the same unpublished work-unit commit and push main normally. Remote delivery evidence is recorded in the Engram mirror/session summary. Maintainer may check English, larger text or other account/shipment states later; no PR/merge or remote Supabase steps are needed.
