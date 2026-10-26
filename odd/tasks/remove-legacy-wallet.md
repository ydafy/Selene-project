# Remove the legacy wallet

Stripe Connect replaced the internal wallet (balances, withdrawals to a CLABE, the drain tool). Remove every trace of it from the app, admin web, Edge Functions and database, including the `connect_enabled` switch that only existed for the cutover.
Branch `feat/remove-legacy-wallet`, worktree `School-portal-worktrees/remove-legacy-wallet`. A related private security advisory exists (maintainer: GitHub > Security); do not describe it in this repository.

## Specs

- S1 (maintainer, verbatim): "wallet se deve quitar en todos lados, tanto app como admin wbe, ya no se usa, incluso lo de drain, osea no pasa anda si lo quitamos, es legacy y lo mejor, son usarios y dinero falso, no ae riesgo, y si, todo lo de wallet lo teniamos anotado segun yo, y ya que etamo, ae que quitarlo para evitar confuciones."
- S2: `connect_enabled` goes too: after S1 nothing reads it (today only `fn_request_payout` and `drain-legacy-wallets` do).
- S3: The tables `wallets`, `wallet_transactions`, `payout_requests`, `seller_bank_accounts` and `mexico_banks` are dropped with their data (test data, S1). AGENTS.md "How money moves" stops describing them as read-only audit history.
- S4: Money behavior that does not involve the wallet stays identical: order creation from a payment, cancellation and refunds, shipment completion, payout release through Connect, dispute resolution, account closure, signup. Each rewritten function keeps every other effect and its tests.

## Inventory (2026-10-25)

- Database (production, Supabase MCP): functions that reference the wallet tables or `connect_enabled`: `fn_cancel_order`, `fn_cancel_shipment`, `fn_close_account`, `fn_complete_shipment_refund`, `fn_confirm_shipment_delivery`, `fn_create_order_from_payment`, `fn_cron_dispute_payout_timeout`, `fn_cron_dispute_shipping_timeout`, `fn_cron_return_delivery_timeout`, `fn_log_return_payment`, `fn_on_auth_user_created`, `fn_release_shipment_funds`, `fn_request_payout`, `fn_resolve_dispute_to_seller`, `fn_resolve_dispute_to_seller_as_admin`, `fn_save_bank_account`. Foreign keys: `payout_requests` -> `seller_bank_accounts`, `payout_requests` -> `wallets`, `wallet_transactions` -> `wallets`. Compare each with its file in `supabase/queries/` before editing (production may differ from the repository).
- Edge Functions: `drain-legacy-wallets` (whole function), `confirm-shipment-delivery`, `resolve-dispute-refund`.
- Admin web (14 files): `DrainLegacyWalletsPage`, `useDrainLegacyWallets`, `UserWalletCard`, `UserTransactionsTable`, `useUserDetail`, `useUpdatePayoutStatus`, `KPIPaymentsCards`, `PayoutReleaseQueue`, `PayoutReleaseWorkbench`, `PaymentsPage`, `DashboardHome`, `UserDetailPage`, `Layout`, `App`.
- App (16 files): `app/profile/wallet.tsx`, `app/profile/withdraw.tsx`, `components/features/wallet/*`, `core/store/useWalletStore.ts`, `core/hooks/useWalletScreen.ts`, mentions in onboarding, `OrderActionCard`, `SellerPaymentExplanation`, `ProfileSkeleton`, `core/services/notification.ts`, i18n `wallet` keys in both locales.
- Mentions that are about Connect payouts, not the wallet, stay (check each hit before deleting).

## Tasks

Order matters for deployment: clients and Edge Functions stop using the wallet before the database drops it.

- [x] T1 (S1) app: remove wallet screens, store, hook, components, notification routes and i18n keys (both locales). Commit 1. Connect onboarding copy moved from `wallet:onboarding` to the `sellerOnboarding` namespace; guard `core/legacyWalletRemoval.test.ts`.
- [ ] T2 (S1) admin web: remove the drain page, wallet card, transactions table and wallet KPIs; Playwright spec for the pages that change. Commit 2.
- [ ] T3 (S1, S2) Edge Functions: delete `drain-legacy-wallets` (and its Bruno requests, `config.toml` entry); remove wallet code from `confirm-shipment-delivery` and `resolve-dispute-refund`. Commit 3.
- [ ] T4 (S4) database, part 1: migration rewriting the signup, order-creation, cancellation and refund functions without wallet writes; update `supabase/queries/`; prove each on the local stack per role. Own commit, native review.
- [ ] T5 (S4) database, part 2: migration rewriting delivery, release, dispute and cron functions without wallet writes. Own commit, native review.
- [ ] T6 (S2, S3) database, part 3: drop `fn_request_payout`, `fn_save_bank_account`, `connect_enabled`, and the five tables; regenerate types after the maintainer applies it. Own commit, native review.
- [ ] T7 (S3) docs: AGENTS.md "How money moves", `docs/go-live.md` (deploy order: T1-T3 deployed before the T4-T6 SQL), backlog and `supabase/AGENTS.md` mentions. Close the private advisory after T6 is deployed.

## Log

- L1: Maintainer, 2026-10-25, verbatim: "okey master, nomas, wallet se deve quitar en todos lados, tanto app como admin wbe, ya no se usa, incluso lo de drain, osea no pasa anda si lo quitamos, es legacy y lo mejor, son usarios y dinero falso, no ae riesgo, y si, todo lo de wallet lo teniamos anotado segun yo, y ya que etamo, ae que quitarlo para evitar confuciones. No entendi lo de connect_enabled a que te refierse? o va dentro de lo de walllet?"
- L2: Found during the BL3 review (cross-module backlog). Production 2026-10-25: `system_settings.connect_enabled = false`; 1 wallet with a balance, 12 payout requests (5 pending), 2 bank accounts, all test data (L1). `apps/frontend/app/profile/wallet.tsx` and `withdraw.tsx` are already placeholder screens. Recommended its own session because T4-T5 rewrite core money functions.
- L3: Maintainer, 2026-10-25, verbatim: "dale arranca, nomas eu recuerda, wallet ya no deveria estar en ningun lado de la app, en terminos de que no pasa nada si lo borras asi, noa e dinero/usarios ni nada real, osea, peudes estar tranquilo de borrarlos no peinses enq ue devemos hacer un backup o mpriemro asegurarnos que no aya dinero atrapado o cosas de ese estilo, todo es simululado, me refiero a que estamos en desarrollo no ae usario reales ni plata real. sijn mas qeu decir dale, pero primero haz el merge del pr, te doy permiso, haslo antes de emepzar para que hagas pull y trabajes en main limpio ya ctualizado". PR #28 merged (8556dd0); this branch rebased on it. Scope of this session: T1-T3; T4-T6 (SQL) wait until the other session's BL1/BL37 PRs merge (shared dispute and payout functions).
- L4: `main` 82980c9 (PR #26) left `fn_acquire_checkout_recovery_lease` inside `fn_admin_update_user_status` in `packages/types/src/database.types.ts`, so `apps/admin-web` does not build (`tsc -b`: TS2345 in `UserSafetyActions.tsx:56`). Not this feature's change; reported to the maintainer.
