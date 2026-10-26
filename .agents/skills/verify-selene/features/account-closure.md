# Account closure

A user closes their account. Users with open obligations are refused and left intact; others are closed and a cleanup worker removes Stripe and storage leftovers.

## Sub-features

- `delete-account`: Edge Function closes a throwaway user (200 `{ success: true }`), refuses a user with a pending obligation, and rejects missing, anon-key, and stale tokens.
- `fn_close_account`: the RPC is callable by service role only; anon and buyer get 403 (`42501`).
- `cleanup-worker`: `account-closure-cleanup` needs the cron secret; processes pending rows and retries failed ones.

## How to get to it (user POV)

Signed-in user opens account settings and requests deletion. No admin-web screen.

## Driving it with Bruno

Preconditions: fresh seed; the seeded buyer has no orders or disputes (`seed.sql` header).

- `bun run api:test` runs the whole collection (116/116 on a fresh seed), including `delete-account-*` and `account-closure-cleanup-*` in `seq` order (setup, action, row check, cleanup; throwaway users come from the Auth admin API). `run functions` alone fails 15 requests on missing tokens: the login requests live in `auth/`.
- `run auth/login-buyer.bru auth/close-account-as-anon-denied.bru auth/close-account-as-buyer-denied.bru auth/close-account-as-service-role-not-found.bru --env local` for the RPC per role.
- `delete-account-blocked` gives the seeded buyer a pending legacy wallet balance, expects a refusal, and `delete-account-blocked-cleanup` restores it.

## Gotchas

- Do not close the real seeded accounts: tokens for deleted users go stale and every later role request fails. Reset if that happened.
- `account-closure-cleanup-no-secret` and the secret variants need `CRON_SECRET` in `bruno/.env`; `bun run bruno:env` warns when it is missing.
