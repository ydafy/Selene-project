# Proposal: Production Gaps Audit

## Intent

Selene is a used PC hardware marketplace in Mexico handling real money, approaching its first launch. Two audit passes identified 39 production-readiness gaps across security, resilience, legal, and maintenance. This proposal consolidates those findings into an actionable, prioritized TODO checklist — not a code change, but a structured plan the founder will execute after feature development completes.

## Overview

First-time founder, 3 months of engineering, a marketplace handling real payments — and production gaps that could tank the launch. The two audit passes found: 5 critical security holes (RLS wide open, auth trigger broken, .env leaked), 8 high-priority gaps needed for App Store approval, 9 medium hardening items, and 5 backlog improvements. Plus legal/compliance TODOs no code can fix.

This is the pre-flight checklist. Fix blockers first, then launch requirements, then harden incrementally.

## Scope

### In Scope

- RLS policies on all user-facing tables
- Auth trigger bug (wrong column references)
- Protected route redirect restoration
- .env removal from git history
- Crash reporting (Sentry)
- Email verification enforcement
- Rate limiting on Edge Functions
- Storage bucket policies
- iOS/Android App Store requirements
- Push notifications setup
- Session expiry recovery in checkout
- Pay button debounce guard
- DB indexes for high-frequency queries
- Zod validation on Edge Functions
- CORS restriction
- XSS prevention / input sanitization
- Image upload validation
- Accessibility labels
- Analytics strategy (Sentry + PostHog)
- Legal/compliance TODO list

### Out of Scope

- New feature development
- Architecture refactoring beyond gap remediation
- Performance optimization beyond adding indexes
- Admin dashboard redesign
- Offline-first architecture

## Capabilities

### New Capabilities

- `production-readiness`: Cross-cutting capability covering all production gap remediation — security hardening, resilience, observability, App Store compliance, and legal checklist

### Modified Capabilities

- None — this is additive infrastructure and configuration, not a behavior change to existing specs

## Approach

Four-tier priority system based on blocking severity:

1. **Blockers** → Fix immediately. These are security holes that make even internal testing dangerous.
2. **Launch Requirements** → Fix before App Store submission. Without these, rejection is likely or production behavior is dangerous.
3. **Hardening** → Fix within the first month post-launch. Important but not blocking.
4. **Nice-to-Have** → Backlog. Improvements that polish but don't block.

Legal/compliance items are non-code TODOs the founder must research and complete in parallel.

Analytics: Sentry (free) for crash reporting as launch minimum, PostHog (free tier) for product analytics in month one.

## Priority 1: BLOCKERS (Must fix BEFORE any testing phase)

| #   | Gap                                                                                                                                             | Risk                                               | Fix                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| B1  | RLS policies missing on most tables                                                                                                             | Any user can read/modify other users' data         | Add RLS policies for every user-facing table; enable RLS            |
| B2  | Auth trigger `fn_on_auth_user_created` references wrong columns (inserts `role`/`email`/`status` into `profiles` instead of `profiles_private`) | New users may not get profiles created correctly   | Fix trigger to insert into `profiles_private` for restricted fields |
| B3  | Protected route redirect commented out                                                                                                          | Unauthenticated users can access protected screens | Restore redirect logic in auth guard                                |
| B4  | `.env` files committed to git with real keys                                                                                                    | API secrets exposed in repo history                | Remove from git, rotate ALL keys, add to `.gitignore`               |

## Priority 2: LAUNCH REQUIREMENTS (Must fix BEFORE App Store submission)

| #   | Gap                                                           | Risk                                                    | Fix                                                               |
| --- | ------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| L1  | No crash reporting (`system_log` is not crash reporting)      | Crashes invisible in production                         | Add Sentry (free tier), ~2h setup                                 |
| L2  | No email verification enforcement                             | Users purchase without confirmed email — liability      | Enforce `email_confirmed_at` before checkout                      |
| L3  | No rate limiting on Edge Functions                            | Bot can flood payment endpoints                         | Add rate limiting middleware (Upstash Redis or Supabase pg-based) |
| L4  | Storage buckets lack policies                                 | Authenticated users can overwrite arbitrary files       | Add bucket policies for product-images, avatars, etc.             |
| L5  | iOS missing Privacy Policy URL + Age Rating                   | App Store rejection guaranteed                          | Add `infoPlist` entries, host privacy policy                      |
| L6  | Android missing explicit `targetSdkVersion` / `minSdkVersion` | Play Store rejection or forced defaults                 | Set in `app.json` / `build.gradle`                                |
| L7  | No push notifications (expo-notifications)                    | Users only see updates while app is open                | Add expo-notifications, setup push for order updates              |
| L8  | Session expiry mid-checkout — no recovery UX                  | User loses payment flow if session expires mid-checkout | Add session refresh or recovery dialog in payment flow            |
| L9  | Pay button has no debounce guard                              | Rapid taps create duplicate payment intents             | Add debounce/processing state to pay button                       |

## Priority 3: HARDENING (Fix within first month post-launch)

| #   | Gap                                                                   | Fix                                                      |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| H1  | No DB indexes on high-frequency queries (products, orders, shipments) | Add composite indexes for common WHERE/JOIN patterns     |
| H2  | Zod validation missing on most Edge Functions                         | Add request schema validation to every Edge Function     |
| H3  | CORS allows `*` on Edge Functions                                     | Restrict to `selene.com.mx` + Expo origin                |
| H4  | Optimistic updates may go stale                                       | Add TanStack invalidation on mutation error              |
| H5  | No input sanitization on user-generated content (XSS)                 | Sanitize HTML in product descriptions, bios, reviews     |
| H6  | Image upload only validates content-type                              | Validate magic bytes + enforce size limit (5MB)          |
| H7  | No user onboarding flow                                               | Add first-launch tutorial / walkthrough                  |
| H8  | No cookie consent (LFPDPPP — Mexico's privacy law)                    | Add consent banner for web version                       |
| H9  | Missing accessibility labels on interactive elements                  | Audit and add `accessibilityLabel` to all buttons/inputs |

## Priority 4: NICE-TO-HAVE (Backlog)

| #   | Gap                                             |
| --- | ----------------------------------------------- |
| N1  | Offline image caching for product photos        |
| N2  | Consistent loading skeletons across all screens |
| N3  | Admin session timeout warning                   |
| N4  | Migration rollback scripts                      |
| N5  | TypeScript strict mode enablement               |
| N6  | ESLint strict rules                             |

## Legal & Compliance TODO (Non-code — founder must research)

| Item                        | Detail                                                                            |
| --------------------------- | --------------------------------------------------------------------------------- |
| Privacy Policy document     | Required by LFPDPPP (Mexico) + Apple. Must cover data collection, usage, rights   |
| Terms & Conditions          | Marketplace-specific: buyer/seller obligations, dispute process, liability limits |
| Return & Refund policy      | Required by Mexican Consumer Protection Law + App Store guidelines                |
| Cookie consent              | LFPDPPP compliance for web version                                                |
| Apple Developer account     | $99/year — required for App Store submission                                      |
| Google Play Console account | $25 one-time — required for Play Store submission                                 |
| App Store review guidelines | Content policy, IAP rules, minimum functionality requirements                     |
| PCI DSS basic compliance    | Even with Stripe, some requirements fall on the merchant (data handling, SAQ)     |

## Analytics Strategy

| Phase                   | Tool               | Cost      | Effort   | What It Covers                               |
| ----------------------- | ------------------ | --------- | -------- | -------------------------------------------- |
| MINIMUM (before launch) | Sentry             | Free tier | ~2h      | Crash reporting, error tracking, performance |
| First month             | PostHog            | Free tier | 1-2 days | Product analytics, funnels, user flows       |
| Backlog                 | Amplitude/Mixpanel | Paid      | 2-3 days | Advanced cohort analysis if growth demands   |

## Affected Areas

| Area                        | Impact   | Description                                               |
| --------------------------- | -------- | --------------------------------------------------------- |
| `supabase/migrations/`      | New      | RLS policies, auth trigger fix, DB indexes                |
| `supabase/functions/`       | Modified | Rate limiting, Zod validation, CORS restriction           |
| `apps/frontend/app/`        | Modified | Protected route redirect, pay button debounce, onboarding |
| `apps/frontend/core/`       | Modified | Auth flow, push notifications, Sentry integration         |
| `apps/frontend/components/` | Modified | Accessibility labels, input sanitization                  |
| `apps/admin-web/`           | Modified | Session timeout, accessibility                            |
| `supabase/storage/`         | Modified | Bucket policies                                           |
| `app.json`                  | Modified | iOS Privacy Policy, Age Rating, Android SDK versions      |
| `.gitignore`                | Modified | Ensure .env files are excluded                            |
| Legal docs                  | New      | Privacy Policy, Terms, Refund Policy                      |

## Risks

| Risk                                                  | Likelihood | Mitigation                                                                                 |
| ----------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| RLS policies too restrictive, breaking existing flows | Medium     | Test every user flow after adding policies; use service_role bypass only in Edge Functions |
| Auth trigger fix creates migration conflict           | Low        | Test migration on staging first; ensure profiles_private columns exist before deploy       |
| Sentry/PostHog adds bundle size                       | Low        | Use lazy import; Sentry ~30KB gzipped, PostHog ~50KB                                       |
| Email verification blocks legitimate users            | Medium     | Add resend verification flow + clear UX messaging                                          |
| Key rotation invalidates existing sessions            | Medium     | Rotate during low-traffic window; announce maintenance                                     |

## Rollback Plan

- **RLS policies**: Disable RLS on specific tables with `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` if blocking flows
- **Auth trigger**: Drop trigger, deploy corrected version — trigger recreation is non-destructive
- **Sentry**: Remove provider wrapper — app works without it (crash reports just stop)
- **Rate limiting**: Feature-flag or remove middleware — requests pass through
- **CORS**: Revert to `*` if blocking legitimate origins
- **Key rotation**: Keep old keys as fallback env vars during transition (where supported)

## Dependencies

- Supabase CLI for migration deployment
- Sentry account (free tier)
- PostHog account (free tier)
- Expo Notifications setup (APNs/FCM credentials)
- Apple Developer enrollment ($99/year)
- Google Play Console enrollment ($25)
- Legal counsel for Mexican compliance documents

## Success Criteria

- [ ] All 4 blockers (B1-B4) resolved and verified
- [ ] All 9 launch requirements (L1-L9) resolved before App Store submission
- [ ] Sentry capturing crashes in production
- [ ] Email verification enforced at checkout
- [ ] Rate limiting active on payment-related Edge Functions
- [ ] App Store submission passes review (Privacy Policy, Age Rating present)
- [ ] No `.env` files in git history (keys rotated)
- [ ] Legal documents (Privacy Policy, Terms, Refund Policy) published
