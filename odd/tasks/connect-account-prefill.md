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

- T1 (S1, S5): baseline. Local stack, Bruno call to the current `create-connect-account`, record the hosted form screens. Route: inline. Commit: none (evidence in Log).
- T2 (S2, S3, S4): test first, then send `identity.entity_type`, `defaults.profile.business_url` (new function setting) and `defaults.profile.product_description`; document the setting and the go-live step. Route: inline. Commit: pending.
- T3 (S1, S3, S5): rerun the Bruno call with T2, record the remaining screens, compare with T1, and write the result where #551 can use it. Route: inline. Commit: pending.

## Log

- L1 (maintainer, 2026-11-15): "Retomá el roadmap #548 con #550 en el worktree bruno-money-functions; antes revisá si #613 puede pasar en la práctica y dime que opinas de loq ue vas atacar."
- L2 (2026-11-16): #613 closed as not reachable (only `fn_close_account` clears `stripe_account_id`, and it blocks on unpaid completed shipments).
- L3 (maintainer, 2026-11-16): "a okey, si, obvio, es individual."
- L4 (2026-11-16): reading `supabase/functions/.env` is blocked by the agent safety policy; the maintainer chose the experiment through the real function (S5).
- L5 (2026-11-16): stripe 23.1.0 types (`node_modules/stripe/cjs/resources/V2/Core/Accounts.d.ts`) have `identity.entity_type`, `defaults.profile` and `mcc` under a configuration block; Selene sends no `merchant` configuration, so MCC prefill is to be confirmed in T1/T3, not assumed.
