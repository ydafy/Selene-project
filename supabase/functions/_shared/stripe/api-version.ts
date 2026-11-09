import type Stripe from './sdk.ts';

// The API version every Stripe client and per-request override sends. Typing it
// as the pinned SDK's LatestApiVersion makes `deno check` fail when the SDK pin in
// ./sdk.ts moves without this value.
export const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-10-28.endive';
