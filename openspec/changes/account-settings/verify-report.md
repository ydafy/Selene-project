# Verification Report — account-settings

**Change**: account-settings
**Project**: Selene (Marketplace for used PC hardware — Mexico)
**Mode**: hybrid (openspec files + Engram `sdd/account-settings/*`)
**Date**: 2026-06-04
**Verdict**: **PASS WITH WARNINGS**

---

## Executive Summary

| Metric | Value |
|---|---|
| Spec compliance | 9/10 broadly met — **1 strict CRITICAL miss** on CONF-007 |
| CRITICAL findings | 1 |
| WARNING findings | 8 |
| SUGGESTION findings | 5 |
| Tasks completed | 17/18 (5.4 explicitly skipped) |
| Test result | `bun test` — 66 pass / 0 fail / 10 files |
| Static (TypeScript) | not run (no isolated tsc check in scope; CI runs full pipeline) |

The implementation is **functional and broadly spec-compliant**: every section, route, dialog, optimistic update, blocked-reason branch and Edge Function pre-check is present and exercised by unit tests. One CRITICAL i18n bleed (hardcoded `"OK"`) must be fixed before merge, plus a UX gap on CONF-005 (typed-phrase enforcement happens after click instead of disabling the destructive button).

---

## Completeness — Task Coverage

| Phase | Tasks | Done | Notes |
|---|---|---|---|
| 1 Foundation | 4 | 4 | i18n + hooks added cleanly |
| 2 Edge Function | 3 | 3 | Auth, 4 pre-checks, Stripe TODO guard, auth.admin.deleteUser |
| 3 Component Wiring | 4 | 4 | Cog navigates, Direcciones routes |
| 4 Screen Assembly | 3 | 3 | Layout, ordering, pending aggregation |
| 5 Testing | 4 | 3 | 5.4 **explicitly skipped** (no RNTL setup in project) |

Skipped 5.4 (section rendering / route handler component tests) is documented in `tasks.md`; pure helpers cover the testable logic. This is acceptable, but it means **CONF-001/003/004/009/010 have no automated regression net** — they rely on unit-tested helpers + manual verification.

---

## Build / Tests / Coverage Evidence

```
$ bun test
bun test v1.3.11
 66 pass
 0 fail
 90 expect() calls
Ran 66 tests across 10 files. [64.00ms]
```

Targeted test files for this change:

```
$ bun test apps/frontend/core/hooks/useUpdateProfile.test.ts apps/frontend/core/hooks/useDeleteAccount.test.ts
 20 pass / 0 fail / 24 expect() calls
```

- `useUpdateProfile.test.ts` — 8 tests: chained mock for `from/update/eq`, success/error paths, 23505 → `usernameTaken`, fallback → `updateFailed`.
- `useDeleteAccount.test.ts` — 12 tests: every blocked_reason maps to its i18n key, unknown reasons fall through to `deleteFailed`, `validateDeleteConfirmation` trims and is case-sensitive.

Coverage gap: `useDeleteAccount` (the mutation wrapper itself) is **not** integration-tested. Only the pure helpers. The mutation's swallow-errors-into-result-shape behavior is design-by-contract but undocumented at the hook level.

---

## Spec Compliance Matrix

| Spec | Status | Evidence |
|---|---|---|
| CONF-001 Settings screen rendering | ✅ PASS | `app/profile/settings.tsx` renders 4 `SettingsSection`s in order Account → General → Security → Privacy; `GlobalHeader` shown; skeleton shown while `isLoadingProfile` |
| CONF-002 Username editing | ⚠️ PARTIAL | Regex enforced (`^[A-Za-z0-9_.]{3,30}$`), optimistic update + rollback in `useUpdateProfile.onMutate/onError`, 23505 → `errors.usernameTaken` via `mapUpdateProfileError`. **Design said RHF + Zod; implementation uses raw `useState` + inline regex.** Also regex is **stricter** than spec (`{3,30}` length added beyond `+`) |
| CONF-003 Settings navigation links | ✅ PASS | `GeneralSection` routes Direcciones → `/address/form`, Notificaciones → `/profile/notifications`; Wallet absent |
| CONF-004 Logout confirmation | ✅ PASS | `SecuritySection` opens `ConfirmDialog`; `handleConfirm` runs `supabase.auth.signOut()`; `loading` flag blocks repeat taps |
| CONF-005 Delete Account flow | ⚠️ PARTIAL | Double `ConfirmDialog` (`first` → `second` → `feedback`), typed phrase validated by `validateDeleteConfirmation`. **Edge case violated**: spec says "Phrase mismatch MUST keep destructive submit disabled" — current UX leaves the destructive button enabled and only blocks the deletion server-call after click (shows error feedback dialog). Functionally safe, literally non-compliant |
| CONF-006 Delete pre-check guard | ✅ PASS | Edge Function checks all 4 blockers, each returns `409` + correct `blocked_reason`; status filters match DB enums (verified against `database.types.ts`: `dispute_status`, `order_status_enum`, `payout_status`) |
| CONF-007 i18n coverage | ❌ **FAIL (CRITICAL)** | All other strings come from `settings` namespace and exist in **both** `es` and `en`. **One hardcoded string remains**: `DeleteAccountSection.tsx:139` `confirmLabel="OK"` on the feedback dialog |
| CONF-008 Loading/Error/Pending states | ✅ PASS | `isSaving` disables Save/Cancel + shows `ActivityIndicator`; `ConfirmDialog.loading` blocks dismissal; delete-account result keeps `typedPhrase` cleared on dismiss; pending aggregation through hook `isPending` |
| CONF-009 Profile cog icon fix | ✅ PASS | `profile.tsx:119-121` `handleOpenSettings = () => router.push('/profile/settings')`; `ProfileHeader` prop renamed to `onSettingsPress` and only navigates |
| CONF-010 ProfileActionsBar Direcciones fix | ✅ PASS | `ProfileActionsBar.tsx:31` `onPress: () => router.push('/address/form')` — no console.log on Direcciones |

**Effective compliance**: 9/10 PASS at functional level; **1 strict CRITICAL fail (CONF-007)**; CONF-002 and CONF-005 carry WARNING-level deviations from design/edge-case wording. ≈ **80% strict / 90% functional**.

---

## Correctness Audit

| Area | Verdict | Notes |
|---|---|---|
| Username regex matches spec | ⚠️ Stricter | Spec: `^[a-zA-Z0-9_.]+$`. Code: `^[A-Za-z0-9_.]{3,30}$`. Added length cap not in spec — may reject 1-2-char or 31+ char usernames the spec would allow |
| 23505 mapping | ✅ | `mapUpdateProfileError` checks `error.code === '23505'`; covered by tests |
| Optimistic rollback | ✅ | `onError` restores `previousProfile`, `onSettled` invalidates |
| Delete identity derivation | ✅ | Edge Function derives `user.id` from Bearer token; client sends nothing — cannot delete another user |
| Pre-check status filters | ✅ | All match DB enums |
| Auth gate on settings | ✅ | `<Redirect href="/(tabs)/profile" />` on `!loading && !session` |
| Cog never logs out | ✅ | Old `onLogout` prop renamed; profile.tsx wires `onSettingsPress` only |
| Phrase-mismatch protection | ⚠️ | Protection exists post-click; CONF-005 wording asks for button-disabled |
| Hardcoded UI string | ❌ | `confirmLabel="OK"` (line 139 DeleteAccountSection.tsx) |

---

## Design Coherence

| Design decision | Implementation | Match |
|---|---|---|
| `useUpdateProfile` extends `useProfile.ts` (mirrors avatar) | ✅ Added in same file, similar shape | YES |
| `useDeleteAccount` calls `supabase.functions.invoke('delete-account')` | ✅ Confirmed | YES |
| Sections as discrete components | ✅ 4 components + `SettingsSection`/`SettingsRow` helpers | YES |
| Inline edit with **RHF + Zod** | ❌ Raw `useState` + manual regex | NO |
| Pre-check + Stripe guard + auth.admin.deleteUser | ✅ Implemented in that order | YES |
| New `settings` i18n namespace | ✅ Registered in `core/i18n/index.ts` | YES |
| Stripe Connect TODO guarded by missing column | ✅ Logs presence of `stripe_customer_id`, defers cleanup | YES |
| Pending aggregation in screen | ❌ Each section owns its own pending; screen does not aggregate | PARTIAL |

The RHF+Zod deviation is **not a spec violation** (spec only mandates the regex), but it loses validation centralization and means the test suite cannot reuse a `usernameSchema` import — the regex literal is now duplicated between `AccountSection.tsx` and any future caller.

---

## Issues

### CRITICAL (1)

1. **Hardcoded `"OK"` string in `DeleteAccountSection.tsx:139` violates CONF-007.**
   `confirmLabel="OK"` is rendered raw, untranslated. CONF-007 explicitly forbids hardcoded UI strings in the settings surface.
   **Fix**: add `common.ok` (or `settings.toasts.acknowledge`) translation key in both `es`/`en` and use `t(...)`. Both locales already have `common` namespace loaded — `t('common:ok', 'Aceptar')` is a one-line fix.

### WARNING (8)

1. **CONF-005 edge case — destructive submit button stays enabled on phrase mismatch.**
   `DeleteAccountSection.tsx:109` `onConfirm={handleSecondConfirm}` runs validation only after click and surfaces an error dialog. The spec says "Phrase mismatch MUST keep destructive submit disabled." `ConfirmDialog` doesn't expose a `disabled` prop, so either extend the dialog with `disabled?: boolean` or compute the dialog's child Submit using `validateDeleteConfirmation(typedPhrase) === false`.

2. **Username regex stricter than spec.**
   `AccountSection.tsx:19` adds `{3,30}` length cap not in spec (`^[a-zA-Z0-9_.]+$`). Will reject 2-char or 31+-char usernames that the spec considers valid. Either tighten the spec or relax the regex to match.

3. **Design said RHF + Zod, implementation uses raw `useState` + inline regex.**
   No centralized `usernameSchema`; the regex literal lives only in the component, hidden from tests. Migrating to RHF + Zod would also remove the duplicated trim/empty/regex error branching.

4. **DRY violation — `settings:` prefix-stripping logic duplicated.**
   The exact same idiom `key.startsWith('settings:') ? key.slice(9) : key` lives in `AccountSection.tsx:71` and `DeleteAccountSection.tsx:64`. Should be a shared helper (e.g. `stripNamespace(key, 'settings')` in `core/i18n` or alongside `deleteAccountHelpers`).

5. **`errors.authRequired` i18n key defined but never wired.**
   Both locales ship `errors.authRequired` ("Tu sesión expiró…"). The edge function returns `401 { error: 'UNAUTHORIZED' }` but `mapDeleteAccountResponse` does not branch on `error === 'UNAUTHORIZED'`/`AUTH_REQUIRED`, so a session-expired user sees the generic `deleteFailed` toast. Wire the 401/UNAUTHORIZED path to `settings:errors.authRequired`.

6. **`useDeleteAccount` collapses errors into result shape — undocumented contract.**
   The mutation never throws; failures return `{ ok: false, errorKey }`. TanStack Query consumers won't see `onError` fire on blocked/unauthorized cases. Either (a) document this with a clear JSDoc that the mutation always resolves and consumers must inspect `result.ok`, or (b) throw a typed error and let TanStack route through `onError`. Pick one.

7. **Pending aggregation isn't centralized.**
   Design said the screen owns `updateProfile.isPending || deleteAccount.isPending || isLoggingOut`. Today each section owns its own pending state, so e.g. logout doesn't disable the username editor and vice versa. Low risk because mutually-exclusive actions, but it diverges from design.

8. **`pending_balance` not checked.**
   Edge Function only blocks on `available_balance > 0`. A user with `pending_balance > 0` (funds in flight) can delete the account, potentially leaking pending settlements. Spec only mandates `available_balance`, so this is per-spec but worth raising to product. Add to spec for v2 if confirmed.

### SUGGESTION (5)

1. **Pre-existing `console.log('Ir a Pagos')` remains in `ProfileActionsBar.tsx:36`.** Not in CONF-010 scope (Direcciones only), and Pagos is out of scope per proposal. Leaving for future Wallet rework, but flagging.
2. **`safePush` swallows route errors when `onRouteError` is not provided.** `settings.tsx` doesn't pass an `onRouteError` to `GeneralSection`, so a router error becomes a silent no-op. At minimum add a `console.warn` in the catch.
3. **`useDeleteAccount` could surface a typed `DeleteAccountError` discriminated union** (`blocked`/`unauthorized`/`failed`) instead of an `errorKey` string — caller-side `switch` becomes exhaustive.
4. **CORS `Access-Control-Allow-Origin: *`** on a destructive endpoint. Standard Supabase template, but a stricter allow-list (production app origin only) reduces attack surface.
5. **Component-level smoke tests skipped (5.4).** No regression coverage on route handlers / section composition. Consider a lightweight Expo Router/RNTL setup; otherwise CONF-001/003/004/009/010 stay manual-only.

---

## Security Review

| Check | Result |
|---|---|
| Edge Function validates Bearer token | ✅ `supabaseAdmin.auth.getUser(token)` — JWT signature/expiry verified server-side |
| User cannot delete other users | ✅ identity derived from token; no `user_id` accepted from body |
| Service-role usage limited to admin queries + `auth.admin.deleteUser` | ✅ |
| Frontend auth gate on settings | ✅ `<Redirect>` when no session |
| Delete bypass via UI | ✅ Server validates blockers regardless of UI state; phrase typing is UX-only |
| CSRF | ✅ Bearer-token auth — no cookie session |
| Race on logout / delete | ⚠️ Same-session double-trigger possible if user opens both dialogs simultaneously, but `loading` flags block repeat clicks |
| Log hygiene | ✅ Edge Function logs userId + reason only; no PII beyond Stripe customer id (deferred cleanup logs it intentionally) |

No critical security findings.

---

## Performance Review

- `AccountSection` re-renders only on local `draft`/`localError` change. Not memoized but trivial component.
- `useUpdateProfile` cancels in-flight queries before optimistic write; `onSettled` invalidates once.
- `useDeleteAccount` clears the whole React Query cache on success — correct for sign-out.
- No `useMemo`/`useCallback` needed at current size.

No performance concerns.

---

## Final Verdict

**PASS WITH WARNINGS**

The change is functionally correct, well-tested at the helper layer, and security-clean. **One CRITICAL i18n leak (`confirmLabel="OK"`) must be fixed** before archive. The CONF-005 phrase-mismatch UX should be tightened to literally disable the destructive submit, not just block the network call post-click. Remaining warnings are quality-of-life cleanups (DRY, design alignment, error-mapping completeness) that should be addressed but do not block this PR.
