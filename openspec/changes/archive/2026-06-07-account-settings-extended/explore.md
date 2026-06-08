# Exploration: Account Settings Extended

## Current State

The base account settings cycle is complete at `/profile/settings` with four sections: **Account** (username inline edit), **General** (addresses, notifications), **Security** (logout only), and **Privacy** (delete account with staged confirmation). The UI uses a consistent `SettingsSection` + `SettingsRow` + `ConfirmDialog` (react-native-paper Portal/Dialog) pattern. Profile tab (`/(tabs)/profile.tsx`) already integrates `useProfile`, `useUpdateAvatar`, and `useProfileStats`. Avatar upload uses a native `Alert` prompt (camera vs gallery) and delegates to `useUpdateAvatar` mutation.

### Auth / Data Layer

- `profiles_private.email` column **exists** and is populated on signup via `fn_on_auth_user_created` trigger.
- **No `UPDATE` trigger exists on `auth.users`**. The file `supabase/queries/triggers/auth/fn_on_auth_user_updated.sql` contains a function body that updates `public.profiles` (not `profiles_private`), but there is **no migration that creates the trigger** on `auth.users` for `UPDATE` events. This means `auth.users.email` → `profiles_private.email` sync is **not wired**.
- `@supabase/supabase-js` is at `^2.81.1`. The `currentPassword` parameter for `auth.updateUser()` was added in **v2.102.0** — the installed version **does not support it**.
- `expo-web-browser` (`~15.0.8`) and `expo-constants` (`~18.0.9`) are **already installed**.
- `@chatwoot/react-native-widget` is **not installed**. No Chatwoot env vars exist.

---

## Feature-by-Feature Analysis

### 1. Change Email (Cuenta)

| Aspect | Finding |
|--------|---------|
| **Current State** | No UI for email change. Username edit exists inline in `AccountSection`. |
| **Supabase Behavior** | `auth.updateUser({ email })` on a hosted project **sends a confirmation email to the new address** by default. The user must click the link to confirm. Until confirmed, `user.email` remains the old value. |
| **DB Sync Gap** | `profiles_private.email` will become stale after a confirmed email change because there is **no `UPDATE` trigger** on `auth.users`. |
| **Data Layer Need** | New migration: create trigger `on_auth_user_updated` on `auth.users` that syncs `NEW.email` → `profiles_private.email` (and `profiles.email` if still referenced). |
| **UI Pattern** | Inline editing (like username) or modal. **Recommendation: modal** — email change is destructive (affects login) and requires explanation about confirmation flow. |
| **Validation** | Zod email schema already exists in auth forms; reuse it. |
| **Complexity** | Medium. Requires DB migration + modal + auth API call + handling `UserUpdated` event (or polling). |
| **Risk** | User may not understand they need to confirm the new email. Must show clear copy. Stale `profiles_private.email` breaks any edge function that reads it until trigger is added. |

### 2. Change Password (Seguridad)

| Aspect | Finding |
|--------|---------|
| **Current State** | `SecuritySection` only has logout row. |
| **Supabase Behavior** | `auth.updateUser({ password: newPassword })` works with an **active session** — no current password required by default. |
| `currentPassword` support | **Not available** in installed `@supabase/supabase-js` ^2.81.1 (requires >= 2.102.0). |
| **Options** | A) Upgrade `supabase-js` to ^2.102.0+ and require `currentPassword`. B) Implement without `currentPassword` (session-based only). |
| **Recommendation** | **Option A: upgrade supabase-js** — a marketplace handling money should verify current password before allowing change. This is a one-line dep bump with low risk (supabase-js is backward-compatible). |
| **UI Pattern** | Modal with three fields: current password, new password, confirm new password. Use `FormTextInput` with `secureTextEntry` (eye toggle already built-in). |
| **Validation** | Reuse `z.string().min(8)` from auth forms. Add `refine` for password === confirmPassword. |
| **Complexity** | Low (if upgrading supabase-js) to Medium (if staying on old version and accepting less security). |
| **Risk** | Without `currentPassword`, a stolen session token allows password change → account takeover. |

### 3. Chatwoot Support Widget (Soporte)

| Aspect | Finding |
|--------|---------|
| **Current State** | No support channel in app. No Chatwoot dependency. |
| **Dependency** | `@chatwoot/react-native-widget` — needs `npm install`. It wraps a WebView-based widget. |
| **Env Vars Needed** | `EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN` and `EXPO_PUBLIC_CHATWOOT_BASE_URL` (or similar). |
| **Placement** | Best placed as a **floating action button** on the Profile tab, or as a `SettingsRow` in a new "Soporte" section in Settings. Recommendation: Settings row that opens the widget in a modal screen (or embedded). |
| **Complexity** | Low-Medium. Mostly configuration and env setup. |
| **Risk** | Chatwoot React Native widget may have compatibility issues with Expo SDK 54 / React Native 0.81.5. **Must test in Expo Go first** — if it requires native modules not in Expo Go, may need dev client build. |
| **Alternative** | If Chatwoot RN widget is problematic, fallback to `expo-web-browser` opening the Chatwoot live chat URL directly. |

### 4. Legal Links + App Version (Legales)

| Aspect | Finding |
|--------|---------|
| **Current State** | No legal section. No version display. |
| **expo-web-browser** | Already installed. No existing usage patterns in codebase. Simple API: `openBrowserAsync(url)`. |
| **URLs Needed** | Terms of Service and Privacy Policy URLs (hosted externally, e.g., `/legal/terms`, `/legal/privacy` on selene domain). |
| **App Version** | `app.json` → `"version": "1.0.0"`. Access via `Constants.expoConfig?.version`. Build numbers available via `Constants.expoConfig?.ios?.buildNumber` / `android?.versionCode`. |
| **UI Pattern** | New `SettingsSection title={t('sections.legal')}`. Two `SettingsRow` items (Terms, Privacy) with `showChevron={true}`. Add a non-tappable row at bottom showing version. |
| **Complexity** | Very Low. |
| **Risk** | None. Just need the actual legal document URLs from product/legal team. |

### 5. Profile Tab "Editar Perfil" Modal

| Aspect | Finding |
|--------|---------|
| **Current State** | Profile tab shows `ProfileHeader` with avatar tap → camera/gallery Alert. Username edit is ONLY in Settings screen. There is no unified "Edit Profile" entry point. |
| **Existing Hooks** | `useUpdateProfile` (optimistic update, rollback, error mapping) and `useUpdateAvatar` (upload + DB update, cache invalidation) are **already implemented and battle-tested**. |
| **ProfileHeader** | Has `onEditAvatar` prop. **Does NOT have** `onEditProfile` prop. Need to add it or handle navigation differently. |
| **Approach Options** | A) Add "Editar perfil" button in `ProfileHeader` (or below stats) that pushes `/profile/edit` as a modal route. B) Reuse the existing settings screen by adding an "Editar perfil" row that opens an inline modal. |
| **Recommendation** | **Option A: new modal route `/profile/edit`** — follows Expo Router sheet pattern (`presentation: 'modal'` or `formSheet`), keeps settings screen focused on app-level settings, and mirrors iOS conventions. The modal can reuse `FormTextInput` for username and the existing avatar upload flow. |
| **Complexity** | Low. Reuses 90% existing code (hooks, components, upload logic). Only needs a new route + layout + composition. |
| **Risk** | Low. Need to ensure the modal invalidates `['profile', userId]` query on success (already handled by hooks). |

---

## Data Layer Needs

| Need | Priority | File / Location |
|------|----------|-----------------|
| Create `on_auth_user_updated` trigger on `auth.users` | **High** | New migration: `supabase/migrations/YYYYMMDD_on_auth_user_updated.sql` |
| Fix `fn_on_auth_user_updated` to update `profiles_private.email` instead of (or in addition to) `profiles.email` | **High** | `supabase/queries/triggers/auth/fn_on_auth_user_updated.sql` |
| Upgrade `@supabase/supabase-js` to `^2.102.0`+ (for `currentPassword`) | **Medium** | `apps/frontend/package.json` |
| Add Chatwoot env vars | **Low** | `apps/frontend/.env` + `.env.example` |

### Trigger Specification (Draft)

```sql
CREATE OR REPLACE FUNCTION public.fn_on_auth_user_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Sync email to profiles_private (source of truth for edge functions)
  UPDATE public.profiles_private
  SET email = NEW.email,
      updated_at = now()
  WHERE id = NEW.id;

  -- Optional: also sync to public.profiles if any legacy code reads it
  UPDATE public.profiles
  SET updated_at = now()
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- IMPORTANT: Ensure this trigger actually gets created in a migration
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email OR OLD.last_sign_in_at IS DISTINCT FROM NEW.last_sign_in_at)
  EXECUTE FUNCTION public.fn_on_auth_user_updated();
```

**Critical finding**: The existing `fn_on_auth_user_updated.sql` only contains the function body (no `CREATE TRIGGER` statement), and it updates `public.profiles` (which no longer has an `email` column). **This is broken/misaligned** with the current schema.

---

## Dependencies to Install

| Package | Version | Purpose |
|---------|---------|---------|
| `@chatwoot/react-native-widget` | latest | Support chat widget (verify Expo compatibility first) |
| `@supabase/supabase-js` | `^2.102.0` | `currentPassword` support for password change |

**Already installed (no action needed):**
- `expo-web-browser` ~15.0.8
- `expo-constants` ~18.0.9
- `react-hook-form` ^7.65.0
- `zod` ^4.1.12

---

## Recommended Implementation Order

1. **Legales + App Version** (Very Low effort, immediate user value, zero risk)
2. **Profile Tab "Editar perfil" Modal** (Low effort, reuses existing hooks, improves UX)
3. **DB Trigger Fix + Email Change** (Medium effort, required data layer fix first)
4. **Password Change** (Low-Medium effort, depends on supabase-js upgrade)
5. **Chatwoot Widget** (Low-Medium effort, but requires external service setup + env vars + Expo compatibility testing)

---

## Estimated Scope Per Feature

| Feature | Files Touched | Lines (est.) | Complexity |
|---------|---------------|--------------|------------|
| Legales + Version | `settings.tsx`, `SettingsRow.tsx` (add non-tappable variant), i18n | ~80 | Very Low |
| Profile Edit Modal | New: `app/profile/edit.tsx`, `app/profile/_layout.tsx`; Mod: `ProfileHeader.tsx`, i18n | ~250 | Low |
| Email Change | New: migration, email change modal/component; Mod: `AccountSection.tsx` or new section, i18n | ~200 | Medium |
| Password Change | New: password change modal; Mod: `SecuritySection.tsx`, i18n; Bump: `package.json` | ~180 | Low-Medium |
| Chatwoot Widget | New: support section component; Mod: `.env`, `settings.tsx`, i18n; Maybe: custom dev client | ~120 | Low-Medium |

**Total estimated new/modified lines**: ~830 lines across ~15 files, plus 1 DB migration.

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `fn_on_auth_user_updated` updates wrong table (`profiles` has no `email` column) | **High** — trigger would fail on every auth user update | Fix function body + create actual trigger in migration before any email change feature ships |
| `@supabase/supabase-js` upgrade breaks auth flows | Medium | Run full auth regression (login, register, Google Sign-In, logout) after upgrade |
| Chatwoot widget incompatible with Expo SDK 54 | Medium | Test in Expo Go first; fallback to `expo-web-browser` if needed |
| Email confirmation UX confusion | Medium | Show clear copy: "Te enviamos un correo de confirmación. Tu email no cambiará hasta que confirms el enlace." |
| Password change without current password | Medium | Upgrade supabase-js to require `currentPassword`; otherwise accept session-only risk with documented tradeoff |

---

## Ready for Proposal

**Yes** — with the following prerequisites:

1. **Confirm legal document URLs** (Terms & Privacy) from product/legal team.
2. **Decide on Chatwoot approach**: widget vs. web-browser fallback.
3. **Confirm `@supabase/supabase-js` upgrade** is acceptable (recommended for `currentPassword` security).
4. **Prioritize the DB trigger fix** — it's a latent bug that will break on any auth user update even without this feature.

The exploration surface is well understood, existing patterns are strong (hooks, dialogs, forms), and the scope is bounded. Ready to proceed to SDD Proposal.
