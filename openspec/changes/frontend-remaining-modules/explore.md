# Exploration: Frontend Remaining Modules — Build Order

## Current State

### 1. Favorites Page + Logic

**STATUS:** 100% complete
**What exists:**

- `favorites` DB table (`user_id`, `product_id`, `created_at`) with proper FK relationships
- `useMyFavorites(userId)` hook — TanStack Query, fetches favorites (currently `.limit(6)`)
- `useProductFavorite(productId)` hook — toggle with optimistic update, product existence validation
- `ProductFavoriteButton` component — heart button on product detail pages, triggers auth modal if guest
- `ProfileFavoritesGrid` component — 3-column image grid shown on profile page, has skeleton + empty state
- `AnimatedHeartButton` UI component
- Home screen (`(tabs)/index.tsx`) has heart icon in header → routes to `/profile/favorites`
- Profile page (`(tabs)/profile.tsx`) embeds `ProfileFavoritesGrid` with "Ver todos" button (non-functional — no `onPress`)
- i18n keys exist: `profile.sections.favorites`, `profile.sections.emptyFavorites`, `profile.sections.viewAll`

**What's missing:**

- **`/profile/favorites.tsx` screen** — the route is referenced but the file does NOT exist
- `useMyFavorites` is hardcoded to `.limit(6)` — needs an unlimited variant or parameter for the dedicated page
- `ProfileFavoritesGrid` "Ver todos" `TouchableOpacity` has no `onPress` handler
- i18n keys for a dedicated favorites screen (title, empty state with CTA)

**Dependencies:** None. All data layer is ready.

**Complexity:** Low

**Estimated files:** ~3 new/changed files

- `apps/frontend/app/profile/favorites.tsx` (new screen)
- `apps/frontend/core/hooks/useMyFavorites.ts` (add limit param or create `useAllFavorites`)
- `apps/frontend/core/i18n/locales/{es,en}/profile.json` (add screen keys)

---

### 2. Account Settings Page

**STATUS:** 100% complete
**What exists:**

- `profiles` DB table (`username`, `avatar_url`, `is_verified_seller`, `total_sales`, `average_rating`, `total_reviews`)
- `profiles_private` DB table (`email`, `phone_number`, `stripe_customer_id`, `role`, `status`)
- `useProfile(userId)` hook — reads from `profiles` table
- `useUpdateAvatar` hook — avatar upload to Supabase Storage + DB update
- `useProfileStats` hook — reads pre-computed stats from `profiles`
- Profile screen (`(tabs)/profile.tsx`) — shows profile info, avatar editing, wallet card, action bar, favorites grid
- `/profile/notifications.tsx` screen — full notifications management (read, mark all read)
- `/address/form.tsx` screen — address creation/editing
- `useAddresses` hook — address CRUD
- `ProfileActionsBar` — has "Direcciones" and "Pagos" buttons with `console.log` placeholders

**What's missing:**

- **Dedicated `/profile/settings.tsx` screen** — does not exist
- Profile editing beyond avatar (username, phone number) — no mutation hook for `profiles` or `profiles_private` updates
- Notification preferences UI — notifications screen exists but no "preferences" toggle (push/email settings)
- Language selector — i18n infrastructure exists but no UI to switch languages
- "Direcciones" button in `ProfileActionsBar` → needs to route to existing address management (or create a management screen)
- Security/logout section — logout exists on profile header but no "account security" area
- i18n keys for settings screen

**Dependencies:** Relies on existing `useProfile`, `useAddresses` hooks. May need new hooks for profile editing and notification preferences.

**Complexity:** Medium

**Estimated files:** ~5-7 new/changed files

- `apps/frontend/app/profile/settings.tsx` (new screen)
- `apps/frontend/core/hooks/useProfile.ts` (add `useUpdateProfile` mutation)
- `apps/frontend/components/features/settings/SettingsSection.tsx` (reusable settings group)
- `apps/frontend/components/features/settings/LanguageSelector.tsx` (optional)
- `apps/frontend/components/features/profile/ProfileActionsBar.tsx` (wire up "Direcciones" route)
- `apps/frontend/core/i18n/locales/{es,en}/settings.json` (new file)
- `apps/frontend/core/i18n/locales/{es,en}/profile.json` (add settings menu key)

---

### 3. Saved Cards Page

**What exists (70% complete):**

- `payment_methods` DB table (`stripe_payment_method_id`, `brand`, `last4`, `exp_month`, `exp_year`, `is_default`, `user_id`, `deleted_at`)
- `manage-payment-methods` Edge Function — 3 actions: `list_payment_methods`, `delete_payment_method`, `get_setup_config` (creates SetupIntent + EphemeralKey)
- `usePaymentMethods` hook — list (TanStack Query), delete (optimistic update), getSetupConfig (mutation)
- `PaymentMethod` type exported from `@selene/types`
- `StripeProvider` already initialized in `app/_layout.tsx`
- Card brand icons exist: `VisaIcon`, `MasterCardIcon`, `AmexIcon`
- Checkout already uses `initPaymentSheet` with customer/ephemeralKey pattern
- `profiles_private.stripe_customer_id` — auto-created by edge function if missing
- Payment limit enforcement (max 3 cards) in edge function

**What's missing:**

- **`/profile/payment-methods.tsx` screen** — does not exist
- UI to add a new card — needs Stripe `PaymentSheet` with setup mode OR `CardField` + `confirmSetupIntent`
- `usePaymentMethods.getSetupConfig` returns `{ setupIntent, ephemeralKey, customer, publishableKey }` but no frontend code consumes it yet
- Card display UI — list of saved cards with brand icons, expiry, last4, default badge, delete action
- "Pagos" button in `ProfileActionsBar` → `console.log` placeholder
- i18n keys for payment methods screen
- Error handling for `limit_reached` (edge function throws but frontend has no UI for it)

**Dependencies:** Stripe SDK is configured. Edge function handles all backend logic. The `usePaymentMethods` hook is ready but unused by any screen.

**Complexity:** Medium

**Estimated files:** ~4-5 new/changed files

- `apps/frontend/app/profile/payment-methods.tsx` (new screen)
- `apps/frontend/components/features/payments/SavedCardItem.tsx` (card display component)
- `apps/frontend/components/features/payments/AddCardSheet.tsx` (Stripe PaymentSheet for setup)
- `apps/frontend/components/features/profile/ProfileActionsBar.tsx` (wire up "Pagos" route)
- `apps/frontend/core/i18n/locales/{es,en}/payments.json` (new file)

---

## Recommendation: Build Order

### 1st: Favorites Page (Low effort, highest completion %)

**Why first:**

- **90% done** — all hooks, components, DB, and i18n exist. Only the screen file is missing.
- **Zero dependencies** — doesn't need any new backend work.
- **Quick win** — ~1-2 hours of work. Builds momentum.
- **Unblocks a broken route** — home screen already navigates to `/profile/favorites` which crashes.
- **Testing value** — validates the full favorites flow: toggle → list → navigate → empty state.

### 2nd: Saved Cards Page (Medium effort, backend complete)

**Why second:**

- **70% done** — edge function, hook, DB table, types, and Stripe provider all exist.
- **No backend work needed** — the edge function already handles list, delete, and setup config.
- **Moderate complexity** — Stripe SetupIntent integration is the main unknown, but the checkout already proves the PaymentSheet pattern works.
- **Testing value** — validates Stripe integration end-to-end: add card → list → delete → payment flow uses saved card.
- **Risk mitigation** — if Stripe SetupIntent has issues, we discover them before launch.

### 3rd: Account Settings Page (Medium effort, most open-ended)

**Why last:**

- **40% done** — only profile reading and avatar editing exist. Most features are missing.
- **Most ambiguous scope** — "account settings" could mean many things. Needs product decisions (what settings? notification prefs? language? security?).
- **Requires new mutations** — `useUpdateProfile` for username/phone doesn't exist yet.
- **Lower testing urgency** — users can still use the app without a settings page (profile works, notifications work, addresses work).
- **Can be scoped down** — start with just username editing + language selector, add more later.

---

## Risks

1. **Favorites**: `useMyFavorites` is hardcoded to `.limit(6)`. The dedicated page needs all favorites. Either add a `limit` parameter or create a separate `useAllFavorites` hook.
2. **Saved Cards**: Stripe SetupIntent flow for saving cards has not been tested in this app. The checkout uses PaymentSheet for payments, not for saving cards. May need `StripeSdk.confirmSetupIntent` or a second PaymentSheet in setup mode.
3. **Account Settings**: `profiles_private` is Zero Trust — frontend should NOT write directly. Need an Edge Function or RPC for updating phone/email. This could add significant backend work.
4. **i18n**: All 3 modules need new translation keys. The pattern is established (JSON per namespace), so this is mechanical but easy to forget.

---

## Ready for Proposal

**Yes.** The exploration is complete. All 3 modules have been analyzed with clear gap analysis, dependency mapping, and build order recommendation. The orchestrator should proceed to create an SDD change proposal for implementing these modules in the recommended order: Favorites → Saved Cards → Account Settings.
