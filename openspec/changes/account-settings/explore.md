# Exploration: Account Settings Page

## Current State

### Navigation & Routing
- Profile tab lives at `app/(tabs)/profile.tsx` with tab label "Perfil".
- Inside `app/profile/` there are screens: `[id].tsx`, `favorites.tsx`, `listings.tsx`, `notifications.tsx`, `orders/`, `wallet.tsx`, `withdraw.tsx`.
- **No `/profile/settings.tsx` route exists.**
- `ProfileActionsBar` (horizontal scroll) has 4 buttons: Orders, Listings, Addresses (console.log placeholder), Payments (console.log placeholder).
- `ProfileHeader` shows a `cog-outline` icon in the top-right that currently triggers **logout** — misleading UX.

### Data Layer

#### `profiles` table (public, frontend-writable)
Columns: `id`, `username`, `avatar_url`, `average_rating`, `total_reviews`, `total_sales`, `is_verified_seller`, `created_at`, `updated_at`.
- `useProfile` reads from it directly.
- `useUpdateAvatar` mutates `avatar_url` directly via `supabase.from('profiles').update(...)`.
- **Implication: RLS already allows authenticated users to update their own row.**
- **However: no RLS migration files for `profiles` were found in the repo** — base policies may exist only in the dashboard or an older migration not under version control.

#### `profiles_private` table (Zero Trust)
Columns: `id`, `email`, `last_sign_in_at`, `phone_number`, `role`, `status`, `stripe_customer_id`, `updated_at`.
- Per project convention: "read-only via Edge Functions (service_role), frontend never writes directly."
- Existing Edge Functions (`manage-payment-methods`, `create-payment-intent`, `resolve-dispute`, etc.) read `profiles_private` using `supabaseAdmin` (service_role).
- **Updating `phone_number` requires a new Edge Function or an existing one to extend.**

#### Schema Drift Alert
The auth trigger `fn_on_auth_user_created.sql` attempts to insert `email` and `role` into `public.profiles`, but those columns were moved to `profiles_private` per `database.types.ts`. This trigger will fail if executed on the current schema.

### Existing Hooks & Mutations
- `useProfile.ts`: `useProfile` (read) + `useUpdateAvatar` (mutation).
- **No `useUpdateProfile` or generic profile mutation hook exists.**
- `useAddresses.ts`: Full CRUD with optimistic updates — good reference pattern.
- `useSession.ts`: Handles auth state, `supabase.auth.signOut()`.

### Auth / Logout
- Logout is done via `await supabase.auth.signOut()` directly in `profile.tsx`.
- No dedicated auth hook for logout — just direct Supabase call.
- `AuthProvider` only exposes `session` and `loading`.

### i18n
- Namespaces registered: `common`, `auth`, `product`, `cart`, `search`, `profile`, `sell`, `verify`, `admin`, `address`, `checkout`, `wallet`, `withdraw`, `orders`, `notifications`, `disputes`, `home`, `help`.
- **No `settings` namespace exists.**
- `profile.json` (es/en) has: `menu`, `sections`, `avatar`, `favorites`, `listings`, `review`, `feedback`. No settings keys.

### UI Patterns
- `notifications.tsx` pattern: `GlobalHeader` + `FlashList` + safe area insets + `Stack.Screen options={{ headerShown: false }}`.
- Form pattern (from `address/form.tsx`): `react-hook-form` + `zodResolver` + `FormTextInput` + `FormSelect` + `PrimaryButton` + `Controller`.
- Settings screens in this app should follow: scrollable cards with section headers, inline editing or nav pushes to sub-forms.

### Components Available
- `Box`, `Text` (Restyle base)
- `GlobalHeader`, `ScreenHeader` (layout)
- `FormTextInput`, `FormSelect`, `Checkbox`, `PrimaryButton` (UI)
- `ConfirmDialog`, `EmptyState`, `ErrorState`, `Skeleton` (feedback)
- `AppImage`, `AppChip` (media/selection)

---

## Affected Areas

| File / Area | Why Affected |
|-------------|--------------|
| `apps/frontend/app/profile/settings.tsx` | **New screen** — does not exist. Main deliverable. |
| `apps/frontend/app/(tabs)/profile.tsx` | Needs to change `ProfileHeader` cog icon from `onLogout` to `router.push('/profile/settings')`. |
| `apps/frontend/components/features/profile/ProfileActionsBar.tsx` | "Direcciones" button is `console.log` placeholder — should route to real address list (which exists at `/address/form.tsx` or similar). |
| `apps/frontend/core/hooks/useProfile.ts` | Needs new `useUpdateProfile` mutation for `username` (and potentially bio if added). |
| `apps/frontend/core/i18n/locales/{es,en}/settings.json` | **New namespace** — settings labels, sections, toasts. |
| `apps/frontend/core/i18n/index.ts` | Must import and register `settings` namespace. |
| `packages/types/src/database.types.ts` | Verified `profiles` / `profiles_private` columns. No changes needed unless adding notification prefs. |
| `supabase/functions/` | May need new Edge Function (e.g. `update-profile-private`) for `profiles_private.phone_number`. |

---

## Approaches

### Approach A: Minimal V1 (Frontend-only, no Edge Function)
- Settings screen with editable `username` (writes to `profiles` directly, same pattern as avatar).
- Links to existing flows: Addresses, Wallet, Payment Methods, Notifications.
- Logout button at bottom.
- No phone editing, no language switcher, no notification prefs.

| Pros | Cons | Effort |
|------|------|--------|
| Fast to ship; reuses existing patterns (`useUpdateAvatar` → `useUpdateProfile`). | Does not fix the missing "Direcciones" routing. | Low |
| No backend work. | Phone remains uneditable. | |
| Immediately improves UX (cog icon actually opens settings). | | |

### Approach B: Full V1 with Phone Update (Requires Edge Function)
- Everything in Approach A PLUS phone number editing.
- Create `update-profile-private` Edge Function that validates auth and updates `profiles_private.phone_number` with `service_role`.

| Pros | Cons | Effort |
|------|------|--------|
| Covers both public + private profile data. | Requires Edge Function + deploy. | Medium |
| Follows Zero Trust convention properly. | Adds latency (network round-trip). | |
| | More test surface. | |

### Approach C: Expanded Settings (Schema changes)
- Everything in B PLUS notification preferences, language selector, dark mode toggle.
- Requires new DB table/columns for user preferences (e.g. `user_settings` table or JSONB column).
- Language switcher needs persistence (AsyncStorage) and app reload.

| Pros | Cons | Effort |
|------|------|--------|
| Complete user experience. | High effort; touches DB schema, migrations, RLS, i18n wiring. | High |
| | Overkill for current sprint. | |

---

## Recommendation

**Go with Approach A (Minimal V1) as the baseline, but architect the screen so Approach B slots in cleanly.**

Specifically:
1. **Build `/profile/settings.tsx`** with sections:
   - **Cuenta**: Edit `username` (inline or push to form), avatar thumbnail (tap to edit — reuses existing `handleEditAvatar` logic or routes back to profile).
   - **General**: "Direcciones" → route to address list/form. "Pagos" → route to payment methods (if exists) or show coming-soon. "Notificaciones" → route to `/profile/notifications`.
   - **Seguridad**: "Cerrar sesión" button.
2. **Create `useUpdateProfile` hook** in `useProfile.ts` — mirror `useUpdateAvatar` but update `{ username }`.
3. **Add `settings.json` i18n namespace** for both `es` and `en`, register in `i18n/index.ts`.
4. **Fix `ProfileActionsBar` addresses button** — route to `/address/form.tsx` or existing address screen.
5. **Fix `ProfileHeader` cog icon** — route to `/profile/settings` instead of calling `onLogout`.
6. **Leave a clear TODO/comment** in settings screen for phone number: "Requires Edge Function for profiles_private — see Zero Trust convention."

---

## Risks

1. **Missing RLS policies in repo**: `profiles` updates work today (avatar mutation succeeds), but if the base RLS policies are lost or not in migrations, a fresh environment might break. **Action: verify in Supabase dashboard that `profiles` has an UPDATE policy for `auth.uid() = id` and commit it to `supabase/queries/rls/`.**
2. **Schema drift in auth trigger**: `fn_on_auth_user_created.sql` references `profiles.email` and `profiles.role` which no longer exist. If this trigger runs (e.g. new user signup), it will error. **Action: fix trigger to insert into `profiles_private` instead, or remove those columns from the INSERT.**
3. **No notification prefs DB layer**: If product wants notification toggles later, we need a schema change. Not a blocker for v1, but architect settings sections with expansion in mind.
4. **Avatar editing duplication**: If settings has an avatar edit option, we may duplicate logic. Better: settings shows avatar preview; tapping it navigates back to profile (where the full camera/gallery flow lives) OR we extract the avatar edit logic into a reusable hook.

---

## Ready for Proposal

**Yes.**

The orchestrator should ask the user:
> "Do you want to fix the `profiles` RLS policies and the auth trigger schema drift as part of this change, or treat them as separate tech-debt items? Also, do you want phone number editing in v1 (requires a new Edge Function), or stick to username + navigation links only?"

This will determine whether we scope to **Approach A** or **Approach B**.
