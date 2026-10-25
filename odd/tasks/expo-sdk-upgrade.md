# Expo SDK upgrade (54 -> 58)

Upgrade `apps/frontend` from Expo SDK 54 (`expo@54.0.33`, RN 0.81.5) to SDK 58, one SDK per step, in the worktree `C:/dev/School-portal-worktrees/expo-sdk-upgrade` (branch `chore/expo-sdk-upgrade`).
If a step gets stuck, the branch stays unmerged; `main` is untouched until the whole upgrade passes.

## Specs

- S1: "me la juego actyualicemos" — upgrade to the latest stable Expo SDK.
- S2: "por eso propuse un woktree, por si se rompe algo y al final quedo como que complicado algo, lo dejamos ahi, pero si todo pasa bien, pues lo migarmos a main y los oros woktrees se actualizan" — work only in this worktree; merge to `main` only when everything passes; then rebase the active worktrees.
- S3: Expo's recommendation: upgrade one SDK at a time (`npx expo install expo@^N.0.0 --fix`, then `npx expo-doctor@latest`).
- S4: No regressions against the baseline: `bun test` 3274 pass / 0 fail; typecheck 74 pre-existing errors (no new ones).

## Tasks

- [x] T1 (S1, S3, S4): 54 -> 55 (RN 0.83, React 19.2). Remove `newArchEnabled` from `app.json` (field removed; New Architecture is the only option). Plus `react-native-webview` as a direct dependency (L6).
- [ ] T2 (S1, S3, S4): 55 -> 56 (RN 0.85, TypeScript 6.0.3, iOS min 16.4). `expo-router` drops `react-navigation`: 6 files import `@react-navigation/native` (`ThemeProvider`, `useFocusEffect`, `useScrollToTop`, `usePreventRemove`, theme types); run `npx expo-codemod sdk-56-expo-router-react-navigation-replace`. Add `@expo/vector-icons` explicitly (84 files use it). `expo/fetch` becomes the global `fetch`.
- [ ] T3 (S1, S3, S4): 56 -> 57 (RN 0.86), at least `expo@57.0.23` (Hermes v1 memory fix with reanimated/worklets; startup fix; scene support).
- [ ] T4 (S1, S3, S4): 57 -> 58 (RN 0.88). Strict TypeScript API by default; `ImageBackground` deprecated (1 file: `CategorySnapCard.tsx`); `expo-router` navigation core rework; R8 minify on by default in release (check Stripe, Google Sign-In, Chatwoot keep rules); `NODE_ENV` forced by Expo CLI.
- [ ] T5 (S2): device verification on a new development build (maintainer), then merge to `main` and rebase active worktrees.

## Log

- L1: "me la juego actyualicemos. Pero por eso propuse un woktree, por si se rompe algo y al final quedo como que complicado algo, lo dejamos ahi, pero si todo pasa bien, pues lo migarmos a main y los oros woktrees se actualizan, o me estoy confundiendo? osea que pasa si si hago el upgrade en orto woktree -> todo sale bien -> pasamos ese work a main -> los woktrees se traen esa verson nueva de main para seguir tabajano"
- L2: Release dates (expo.dev/sdk): SDK 55 2026-02-25, 56 2026-05-21, 57 2026-06-30, 58 2026-10-14 (latest patch seen `expo@58.0.19`). Support lifetime of an SDK is about one year. Google Play requires target API 36 since 2026-08-31; RN 0.81 (SDK 54) already targets it.
- L3: Project facts: CNG (no `android/`/`ios/` folders), `newArchEnabled: true`, `web.output: "static"` already set, no `expo-av`, no `react-native/Libraries` deep imports, no `InteractionManager`; `expo-file-system/legacy` used once (`useShareLabel.ts`, `downloadAsync`). Node v22.19.0 (SDK 58 needs >= 22.13). Third-party native deps to watch: `@stripe/stripe-react-native` 0.50.3, `@react-native-google-signin/google-signin` 16, `@chatwoot/react-native-widget` "*", `@gorhom/bottom-sheet`, `moti`, `react-native-paper`.
- L4: Baseline in the worktree after `bun install`: `bun test` 3274 pass / 0 fail; typecheck 74 errors (same set as `main`), saved to `$TEMP/expo-upgrade-typecheck-baseline.txt`.
- L5: T1 `npx expo install expo@^55.0.0 --fix` (from `apps/frontend`): expo ^55.0.0, RN 0.83.10, React 19.2.0, reanimated 4.2.1, worklets 0.7.4, screens 4.23.0, gesture-handler 2.30, `@stripe/stripe-react-native` 0.50.3 -> 0.63.0; it added the `expo-font`, `expo-localization`, `expo-web-browser` config plugins to `app.json`. `newArchEnabled` removed by hand. Stripe changelog 0.51-0.63: only breaking change is `useOnramp` (unused); `initPaymentSheet`/`presentPaymentSheet`/`appearance`/`googlePay`/`StripeProvider` only gained additions; native Stripe SDKs went iOS 24 -> 25 and Android 21 -> 23, so T5 must include a real sandbox payment on device.
- L6: T1 checks. `expo-doctor` on `main` (SDK 54): 3 failures (missing `react-native-webview` peer of `@chatwoot/react-native-widget`, duplicate `expo-constants`/`expo-file-system`, versions not matching the SDK). After T1: `react-native-webview` 13.16.0 declared directly via `npx expo install` (Chatwoot is used in `app/profile/support.tsx`; native peers must be direct dependencies); clean reinstall; 1 failure left, the same pre-existing duplicates of `expo-constants`/`expo-file-system`. `bun test` 3274 pass / 0 fail; typecheck 74 errors, identical set. `bun audit --audit-level=high` with the workflow ignores: 2 highs (body-parser GHSA-27r3-jxmh-p828 via backend express, zod GHSA-mrhx-c7xc-m3w5); `main` has 3 (those plus undici GHSA-xjj6-f33q-929c), so none come from the upgrade.
