## Exploration: stripe-onboarding-ui

### Current State

`apps/frontend/app/sell/onboarding.tsx` already handles auth gating, Stripe return params, a status card, an error banner, and the CTA that opens Stripe. The screen relies on `useConnectOnboarding`, which already launches `create-connect-account`, listens for deep-link returns, refreshes on focus/app resume, and calls `refresh-connect-account-status` with a 60-second server throttle. The main gap now is UX, not transport: there is no pre-Stripe guidance, no visual example for the confusing Stripe business-information steps, several strings still live as inline Spanish fallbacks instead of locale keys, and the `complete` state still renders the generic onboarding frame instead of a dedicated success-only view.

### Affected Areas

- `apps/frontend/app/sell/onboarding.tsx` — primary V1 work; add guidance for non-complete states and a success-only state when onboarding is complete.
- `apps/frontend/core/i18n/locales/es/sell.json` — add onboarding guidance copy in the existing sell namespace.
- `apps/frontend/core/i18n/locales/en/sell.json` — keep locale parity for new onboarding keys.
- `apps/frontend/assets/images/...` — only if V1 uses bundled screenshot/example images.
- `apps/frontend/core/hooks/useConnectOnboarding.ts` — optional V2-only touch if the UI needs extra refresh metadata or richer Stripe response data.
- `packages/types/src/index.ts` — optional V2-only touch if `refresh-connect-account-status` starts returning `requirements.currently_due` / `errors`.
- `supabase/functions/refresh-connect-account-status/index.ts` — optional V2-only touch to expose requirement details instead of status only.
- `supabase/functions/refresh-connect-account-status/refresh-connect-account-status.ts` — optional V2-only touch to normalize and return requirement data safely.

### Approaches

1. **Inline guidance cards** — Add a small explainer section above the CTA with 3-4 cards: what Stripe will ask, how to choose the correct account profile, and a safety note to match real legal/tax circumstances.
   - Pros: Frontend-only, low-risk, easy to localize, likely stays well under the 400-line review budget.
   - Cons: Helpful, but still abstract; it does not directly show the screens the seller finds confusing.
   - Effort: Low

2. **Inline guidance + visual examples** — Keep the explainer cards, but add 1-2 static example screenshots/illustrations inline or behind a lightweight “See examples” affordance using existing image/modal patterns.
   - Pros: Best match for the user intent; directly reduces confusion around “tell us about your business” and “business details”; still frontend-only for V1.
   - Cons: Needs curated assets and future maintenance if Stripe updates its UI; more copy to localize and review.
   - Effort: Medium

3. **Live Stripe checklist (deferred V2)** — Extend `refresh-connect-account-status` to return `requirements.currently_due` / `errors`, then render a personalized checklist in the app.
   - Pros: Personalized and more actionable than static guidance.
   - Cons: Not low-risk V1; requires backend/type/test changes plus careful mapping from Stripe requirement codes to safe user-facing copy.
   - Effort: Medium/High

### Recommendation

Use **Approach 2** for V1: keep the change frontend-only, render guidance only while `status !== 'complete'`, and switch to a dedicated success-only state when onboarding is complete. The best bounded implementation is an inline explainer with safe wording plus a small visual example surface (inline image or lightweight modal), because that addresses the real confusion without reopening backend work. Defer the `currently_due/errors` checklist to V2: the sync plumbing already exists, but the current API contract only exposes status, and turning raw Stripe requirements into safe, understandable copy is more than a small add-on.

### Risks

- Stripe screenshots/examples can drift if Stripe changes hosted onboarding copy or layout.
- Guidance wording can become legally unsafe if it sounds prescriptive instead of conditional; copy must say things like “if you sell as an individual, this is usually the right option” and “choose what matches your real situation.”
- New strings should not remain as inline fallbacks; otherwise the screen keeps adding i18n debt.
- A screenshot-heavy version increases asset and review weight compared with a text-only explainer.

### Ready for Proposal

Yes — the scope is clear and bounded. The orchestrator should tell the user that V1 can stay frontend-only and focused on clearer guidance/visual examples before Stripe, while the personalized `currently_due/errors` checklist should be treated as a follow-up V2 rather than a “small extra.”
