# Onboarding return source

Issue #690, follow-up of #552 (PR #693). Branch `fix/onboarding-return-source` from `origin/main` (0269a8c9), worktree bruno-money-functions.
Carry the publish-flow source (`from=listing`) through Stripe's return so the guide it opens keeps the "Más tarde" exit and the profile success route.

## Specs

- S1. When the payments guide was opened as `/sell/onboarding?from=listing`, the guide that Stripe's return or refresh opens also has `from=listing`: it shows "Más tarde" and its success button goes to the profile. Opened from anywhere else, the return stays as today (`return=1` or `refresh=1` only).
- S2. "El valor que viaja por el puente debe ser cerrado (solo "listing"), para que connect-onboarding-return siga sin ser un open redirect." `create-connect-account` accepts an optional `source` whose only valid value is `listing`; any other value is a 400 validation error before any profile read or Stripe call. `connect-onboarding-return` copies `from` to the app URL only when it equals `listing` and drops any other value; its redirect target stays the configured app URL.
- S3. Tests through the public interface of each function, and Bruno requests on the local stack for both functions (`supabase/functions/AGENTS.md`, "Bruno collection").
- S4. Deploy of `create-connect-account` and `connect-onboarding-return` from `main` after merge, only after the maintainer approves the plan.

## Tasks

- [ ] T1 (S1, S2, S3) Edge Functions: request schema `source`, Stripe-facing URLs carry `from=listing`, bridge keeps only `from=listing`; unit and Bruno tests.
- [ ] T2 (S1) Frontend: the guide sends `source` and deep links with `from` when opened from the publish flow.
- [ ] T3 Native review, PR `Closes #690`, merge.
- [ ] T4 (S4) Deploy plan, maintainer OK, deploy both functions from `main`, check the deployed versions.

## Log

- L1 (2026-11-17, maintainer): "Continuá con #690 en el worktree bruno-money-functions. Creá una rama nueva desde origin/main (por ejemplo fix/onboarding-return-source). [...] Viene de #552 (PR #693, mergeado): mientras el vendedor no tenga cobros, verificar lleva a /sell/onboarding?from=listing, con "Más tarde" y salida a Perfil. Al volver de Stripe se pierde `from` y el vendedor termina en "publicar otro anuncio". [...] Lo hago antes de #553 (la prueba con un usuario real) para que esa prueba no tropiece con este bug. Los guiones de #553 quedan para después. El valor que viaja por el puente debe ser cerrado (solo "listing"), para que connect-onboarding-return siga sin ser un open redirect. Toca Edge Functions (create-connect-account y connect-onboarding-return): probalo con Bruno en el stack local. El deploy de las dos funciones lo hacés vos al final, solo después de mostrarme el plan y que yo diga OK."
- L2 (2026-11-17, evidence): the bridge builds `selene://sell/onboarding?<state>=1` (`connect-onboarding-return/connect-onboarding-return.ts`); `create-connect-account` ignores client URLs and sends Stripe the bridge with `state` only (`create-connect-account/connect-onboarding-urls.ts`); the app reads `from` in `resolveFirstListingOnboardingExit` (`features/payments/logic/first-listing-payment-flow.ts`). Issue #690 has no comments; the files above come from its body.
- L3 (2026-11-17, evidence): independent verify (gentle-ai-verify, risk item 2) on 20712f92 and cddad35b: S1 met, S2 met, no blockers; 26 adversarial bridge queries in 3 env setups never let a value other than `listing` reach Location, nor change scheme, host or path. Five of them pinned as tests. Advisory: a future HTTPS return page must forward `from` (#698). Bruno (S3) pending.
