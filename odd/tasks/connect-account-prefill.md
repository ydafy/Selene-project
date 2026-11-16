# Connect account prefill (#550)

Roadmap #548, item 2. `create-connect-account` creates the Stripe v2 account with the seller already identified as an individual, with a Selene URL and a product description, so the hosted form stops asking business questions.
Branch `feat/connect-account-prefill` from `origin/main`, worktree `bruno-money-functions`.

## Specs

- S1 (issue #550, step 1): "In the sandbox, create a v2 account with `identity.entity_type: individual`, `defaults.profile.business_url` and `defaults.profile.product_description`, and open its hosted form. Record which screens remain."
- S2 (issue #550, step 2): "If the business questions are gone, `create-connect-account` sends those fields. The URL comes from a new function setting, and `docs/go-live.md` must list "set the real Selene URL before go-live". Stripe rejects `example.com`-style URLs."
- S3 (issue #550, step 3): "Test first. Verify in the sandbox."
- S4 (maintainer, 2026-11-16): every seller account is `individual` ("a okey, si, obvio, es individual.").
- S5 (maintainer, 2026-11-16): the sandbox experiment runs through the real function on the local stack with Bruno; the agent never reads `supabase/functions/.env`. First a baseline with the current code, then the code with the prefilled fields, and the screens are compared with Playwright.

## Tasks

- [x] T1 (S1, S5): baseline. Local stack, Bruno call to the current `create-connect-account`, record what the hosted form asks. Route: inline. Commit: none (evidence L6-L7).
- [x] T2 (S2, S3, S4): test first, then send `identity.entity_type`, `defaults.profile.business_url` (`SELENE_CONNECT_BUSINESS_URL`) and `defaults.profile.product_description`; document the setting and the go-live step. Route: inline. Commits: 3a8055f5, 64384c55.
- [x] T3 (S1, S3, S5): rerun the Bruno call with T2, record the remaining screens, compare with T1, and write the result where #551 can use it. Route: inline. Commit: this Log entry (L10); the maintainer's pass of the hosted form is pending (hCaptcha).

## Log

- L1 (maintainer, 2026-11-15): "Retomá el roadmap #548 con #550 en el worktree bruno-money-functions; antes revisá si #613 puede pasar en la práctica y dime que opinas de loq ue vas atacar."
- L2 (2026-11-16): #613 closed as not reachable (only `fn_close_account` clears `stripe_account_id`, and it blocks on unpaid completed shipments).
- L3 (maintainer, 2026-11-16): "a okey, si, obvio, es individual."
- L4 (2026-11-16): reading `supabase/functions/.env` is blocked by the agent safety policy; the maintainer chose the experiment through the real function (S5).
- L5 (2026-11-16): stripe 23.1.0 types (`node_modules/stripe/cjs/resources/V2/Core/Accounts.d.ts`) have `identity.entity_type`, `defaults.profile` and `mcc` under a configuration block; Selene sends no `merchant` configuration, so MCC prefill is to be confirmed in T1/T3, not assumed.
- L6 (2026-11-16): baseline account `acct_1UcJ6TACloAcowPp` (seeded buyer; the seeded seller has the fake `acct_local_seller_pending`, which fails manual payouts). The hosted form shows an hCaptcha after "Use test phone number"; the agent does not solve CAPTCHAs, so screens are read from the account requirements (Stripe MCP, read-only) and the maintainer confirms the form by hand.
- L7 (2026-11-16): baseline `requirements.currently_due`: `business_profile.url`, `business_type`, `external_account`, `tos_acceptance.date`, `tos_acceptance.ip`. No MCC is due (recipient configuration), so no MCC prefill.
- L8 (2026-11-16): `supabase/functions/.env` and `.env.example` are blocked for the agent; the maintainer adds `SELENE_CONNECT_BUSINESS_URL` to both. Until `.env` has it, every local call to `create-connect-account` answers 500 `MISSING_SERVER_CONFIG` (including Bruno `functions/create-connect-account-invalid-link`).
- L9 (2026-11-16): independent verify (risk item 5): S2 and S4 met, S3 met for tests and unproven for the sandbox (T3). Its advisories fixed in 64384c55: the URL is trimmed (whitespace test RED then GREEN), the Bruno request lists `SELENE_CONNECT_BUSINESS_URL`, and `supabase/functions/AGENTS.md` names the request. Native review assess: risk high (escalated item 5), `reviewDue: false` (under budget).
- L10 (2026-11-16): after `supabase db reset`, Bruno created `acct_1UcJMeACloJvncJ6` with T2 (`SELENE_CONNECT_BUSINESS_URL=https://github.com/ydafy` locally); `functions/create-connect-account-invalid-link` passes again (400). Stripe stored `business_type: individual` and `business_profile.url`. `requirements.currently_due`: `external_account`, `individual.first_name`, `individual.last_name`, `tos_acceptance.date`, `tos_acceptance.ip`; `eventually_due` adds `individual.address.*` (city, line1-3, postal_code, state, town) and `individual.dob.*`. Compared with L7, `business_type` and `business_profile.url` are gone. Stripe also derived `settings.dashboard.display_name` ("Github") and `settings.payments.statement_descriptor` ("GITHUB.COM") from the URL: with the real domain every seller's Express dashboard will show Selene's name.
- L11 (maintainer, 2026-11-16): manual pass of the hosted form: "todo bien master me gusto, ya es mas simple". It showed in English because the form auto-detects the browser language (its language picker lists "Español (América Latina)"). Decision: no `defaults.locales`; the device language is enough ("no master dejalo asi").
- L12 (maintainer, 2026-11-16): keep "Selene" as the derived account name ("me gusta que diga 'selene' la evrdad. Dejemoslo para depues"). Sending the seller's username as `display_name` is recorded as Idea #635.
