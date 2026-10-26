# Product verification

Listings carry a verification state. The public view shows listings in the visible states and hides rejected ones; proof files are private to the owner and admins; the admin queue and seller trust stats are role-gated.

## Sub-features

- `public-visibility`: anon and buyer read the same `products_public` rows; rejected listings are hidden; origin ZIP and verification data never appear.
- `purchase-gate`: only verified listings can be reserved (see Checkout).
- `proof-storage`: seller uploads and signs proofs in the `verification` bucket; buyer is denied; admin signs any.
- `admin-queue`: `admin_product_queue_view` and `seller_trust_stats` return data to admins, empty for buyers, denied to anon.
- `release`: the release RPC is service-role only.

## How to get to it (user POV)

Buyer browses listings (public view). Seller submits proof for a listing. Admin reviews the queue in admin-web.

## Driving it with Bruno

Preconditions: fresh seed (listings `...0b1` to `...0b7` in different states).

- Products, in one invocation with the logins (37/37 on a fresh seed): `run auth/login-buyer.bru auth/login-seller.bru auth/login-admin.bru products --env local`. Covers `products-public-*` (anon, buyer, embeds, hidden columns, insert/patch/delete denied), `public-*`, `notify-product-*`, `payment-readiness-*`, `release-*` per role.
- `run auth/login-buyer.bru auth/login-seller.bru auth/login-admin.bru verification --env local` (14/14): seller upload and sign, buyer denied, admin sign, queue and trust stats per role. The upload request sets `proofName` for the signing requests.

## Gotchas

- Admin-web has no Playwright local spec for the queue; the verdict comes from the role checks above. State that when reporting.
- Folders mutate listings only through setup requests that restore them; after an aborted run, `supabase db reset`.
- Run the login requests in the same invocation, or every role request fails on a missing token.
