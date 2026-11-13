# Connect accounts v2 (#330)

Seller onboarding creates Stripe Accounts v2 with the `recipient` configuration; every other Stripe call stays on the v1 endpoints. Two layers keep automatic payouts off.
Branch `feat/connect-accounts-v2`. Roadmap #335, item 6. Engram mirror `odd/connect-accounts-v2/tasks`.

## Specs

- **S1** `create-connect-account` creates the seller account with `POST /v2/core/accounts` (`Stripe-Version: 2026-10-28.endive`): `identity.country: "mx"`, `dashboard: "express"`, `defaults.currency: "mxn"`, `defaults.responsibilities.fees_collector: "application"` and `losses_collector: "application"`, `configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested: true`, `contact_email`, and the same `metadata` as today (`supabase_user_id`, `app_name`). It requests no `merchant` configuration and no `card_payments` (Selene uses separate charges and transfers).
- **S2** The onboarding link comes from `POST /v2/core/account_links` with `use_case.type: "account_onboarding"` and `use_case.account_onboarding.return_url` / `refresh_url` built exactly as today (`connect-onboarding-urls.ts`; client URLs are never forwarded). It sends no `configurations` field: endive rejects it with `Unknown field` (spike, comment on #330).
- **S3** Layer 1, at creation. A new v2 account starts with automatic daily payouts (spike: `balance_settings.payments.payouts.schedule.interval = daily`). The function stores `stripe_account_id` as soon as Stripe returns it, then sets manual payouts with `POST /v1/balance_settings` (`Stripe-Account` header, `payments[payouts][schedule][interval]=manual`). If that call fails, the function returns an error and no onboarding link. Every call that reuses an existing account applies manual payouts again before it mints a link, so a retry repairs the account and never creates a second one.
- **S4** Layer 2, account readiness. A connected account whose `settings.payouts.schedule.interval` is not `manual`, or whose snapshot lacks it, is not actionable for payouts, the same way an account without a usable bank account is not. The only producer of payout actionability is the current-state refresh in `stripe-webhooks` (`applyConnectAccountActionability`, run for every account and external-account event) and its commit RPC `fn_commit_connect_account_refresh`, which rebuilds the gate itself; both apply the rule, with blocked reason `payouts_schedule_not_manual`. `refresh-connect-account-status` writes only the onboarding status and stays as is.
- **S5** A `recipient` account never has `charges_enabled` (no `card_payments`). Onboarding status becomes `complete` when payouts are enabled and the `transfers` capability is active, without requiring `charges_enabled`. `pending` and `rejected` keep their current meaning. No seller-readiness check may depend on `charges_enabled`.
- **S6** Docs and Bruno match the new flow: the Bruno requests for `create-connect-account`, `docs/go-live.md` and `supabase/functions/AGENTS.md` where they describe connected accounts, and an entry in `docs/decision-log.md` recording the #330 decision (v2 for creation and onboarding, v1 endpoints for the rest, full v2 events judged overengineering for the MVP).
- **S7** Verified end to end in the sandbox: unit tests, `bun test`, lint, typecheck and the Edge Function checks; the Bruno sandbox suite (`BRUNO_STRIPE_SANDBOX=1` with `bun run stripe:listen`); one hosted onboarding in test mode that returns to the app bridge, records `account.updated`, reaches `complete`, and completes one manual payout. That run also records how many fields the hosted form asks for, against v1 Express with `card_payments`.

## Tasks

- [x] T1 S1-S3: v2 creation, v2 account link, layer 1 (`create-connect-account`); a failed manual-payouts call answers 500 `MANUAL_PAYOUTS_FAILED`. Route: worker. Commit: this commit (`feat(functions): create seller accounts with Stripe Accounts v2`).
- [ ] T2 S5: onboarding `complete` without `charges_enabled` (`_shared/stripe/connect-status.ts` and its callers). Route: worker (done, uncommitted). Commit: pending.
- [ ] T3 S4: layer 2 in account actionability: migration changing `fn_commit_connect_account_refresh` (new payout-interval input), then `stripe-webhooks`. Route: worker. Commit: pending (SQL and TypeScript).
- [ ] T4 S6: docs, decision log, Bruno. Route: inline. Commit: pending.
- [ ] T5 S7: sandbox verification end to end. Route: inline plus verifier. Evidence: pending.

## Log

- **L1** (2026-11-12) "Sigamos con el roadmap #335, último ítem: #330, decidir si el onboarding de vendedores pasa de cuentas v1 Express a Stripe Accounts v2. Antes de proponer nada, investigá la documentación actual de Stripe y el código de create-connect-account, y traeme las opciones con tu recomendación. Es una decisión de producto, así que nada de código hasta que yo elija."
- **L2** Maintainer chose option B: "okey, mira, acepto tu plan, el de b, y acepto lo de la prueba que ocmentas". Spike green light: "okey me gusta, dale master, ahora si luz vrede".
- **L3** Spike results (sandbox, accounts deleted, comment on #330): v2 `recipient` MX with application responsibilities works; new account starts with daily payouts; `POST /v1/balance_settings` manual works; v1 `account.updated` for the v2 account carries `payouts_enabled`, `requirements`, `external_accounts` and `settings.payouts.schedule`; Account Links v2 rejects `configurations`; the v1 view shows `charges_enabled: false` and only the `transfers` capability (source of S5).
- **L4** Both layers approved: "hagamos las dos master, dale."
- **L5** T3 worker stopped before code: `fn_commit_connect_account_refresh` recomputes the gate from `p_payouts_enabled` and the MXN destination and raises `INVALID_CURRENT_ACCOUNT_SNAPSHOT` on any other blocked reason, so layer 2 needs a migration. `internal.connect_account_actionability.blocked_reason` has no CHECK. S4 clarified: only the `stripe-webhooks` current-state refresh produces actionability.
