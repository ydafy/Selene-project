# Expo SDK 58 plan

The plan for upgrading `apps/frontend` from Expo SDK 57 (`expo@57.0.31`, RN 0.86.3) to SDK 58 (`expo@58.0.22`, RN 0.88.1), and for replacing the stalled packages from #99 first.
This document covers roadmap item #128 (part of #127): research only, no code. Roadmap items #131 and #132 carry out the tasks below.
The procedure from the previous upgrades still applies: `odd/tasks/expo-sdk-upgrade.md` and `docs/dependencies.md`.

## Specs

- S1: "Verificá que el ítem siga vigente (versiones del SDK 58, el estado de #99, el reporte #95)."
- S2: "Solo investigación y el documento odd/tasks/expo-sdk-58.md con tareas, riesgos y el checklist de dispositivo. Sin código."
- S3: "Si descubrís pasos nuevos o un orden mejor, comentalo en #127 con el porqué. Las ideas que salgan van como issues \"Idea\", según AGENTS.md."
- S4: From #128: "Read the SDK 58 changelog and breaking changes, pick replacements for `moti`, `@miblanchard/react-native-slider`, and `react-native-otp-textinput`, check the `@expo/vector-icons` codemod, and write `odd/tasks/expo-sdk-58.md` with tasks and the device checklist."

## Tasks

Research (this item, #128):

- [x] R1 (S1): check that the item still holds (L2).
- [x] R2 (S4): read the SDK 58 changelog, the Expo Router 57 to 58 migration guide, and map their breaking changes to the app (L3, L4).
- [x] R3 (S4): pick a replacement or a decision for each package in #99 (L5).
- [x] R4 (S2): write this document with tasks, risks, and the device checklist.
- [x] R5 (S3): comment the plan changes on #127.

Before the upgrade, on SDK 57 (roadmap item #131 for P1, #148 for P2 to P4). Each task is one commit:

- [ ] P1 (L5): replace `moti` with Reanimated 4. The app imports only `MotiView` (`from`, `animate`, `transition`, `loop`, `delay`) in 27 files. Use `entering` layout animations for mount fades and `useSharedValue` with `withRepeat` for loops such as `components/ui/Skeleton.tsx`. Update the `moti` mock in `tests/prepare/prepare-shipment-submit.mount.test.tsx`. About 250 to 400 changed lines.
- [ ] P2 (L5): replace `react-native-otp-textinput` with an in-house `OtpInput` component: one hidden `TextInput` (`textContentType="oneTimeCode"`, `autoComplete="sms-otp"`, `maxLength={6}`) under six boxes, with a `clear()` handle. Callers: `app/(auth)/verify-code.tsx` and `app/(auth)/resetPassword.tsx`. Test-first, with a mount test for typing, paste, and `clear()`.
- [ ] P3 (L4): move the sell exit guard from `beforeRemove` to `usePreventRemove`. SDK 58 removes the `beforeRemove` event. `core/hooks/useExitGuard.tsx` and `core/utils/navigationGuard.ts` (used by `app/sell/_layout.tsx`) subscribe to it and store the blocked action. Keep the current rule: a `REPLACE` (publishing) passes and other removals open the discard dialog. On confirm, call `repeat()` instead of `navigation.dispatch(pendingAction)`. `usePreventRemove` already exists on SDK 57 (`expo-router/react-navigation`), so this lands before the upgrade.
- [ ] P4 (L4): replace `ImageBackground` in `components/features/shop/CategorySnapCard.tsx` with a `View` and an absolutely positioned `expo-image` `Image`. SDK 58 deprecates `ImageBackground`.

The upgrade (roadmap item #132), in its own worktree, one commit per task:

- [ ] U1 (L3): from `apps/frontend`, run `npx expo install expo@^58.0.0 --fix`, then `npx expo-doctor@latest`. Expected moves: RN 0.88.1, React 19.3.0, reanimated 4.7.1, worklets 0.13.0, gesture-handler ~3.3.0, screens ~4.30.1, safe-area ~5.10.1, svg 15.16.0, webview 14.0.1, `@stripe/stripe-react-native` 0.81.0, `@shopify/flash-list` 2.3.2. `@react-native-async-storage/async-storage` stays at 2.2.0. Move `react-test-renderer` to the React version the SDK installs. Check #105 (same-version duplicates) with the new doctor.
- [ ] U2 (L3): fix the typecheck under the React Native Strict TypeScript API. There are no `react-native/Libraries` deep imports. The likely errors are the refs typed with component classes (`useRef<ScrollView>`, `useRef<FlatList>`, `useRef<View>` in 5 files) and the third-party ref types (OTP is gone after P2). Migrate now. Do not add the `react-native-legacy-deep-imports` opt-out, because React Native removes it after 0.89.
- [ ] U3 (L4): move `usePreventRemove` imports from `expo-router/react-navigation` to `expo-router`, as the migration guide shows. Keep `useFocusEffect`, `useScrollToTop`, `ThemeProvider`, `DarkTheme`, and `Theme` where they are: SDK 58 does not remove them. Run `bun test` for the 4 tests that mock or assert that module.
- [ ] U4 (L3): read the Stripe React Native changelog from 0.65 to 0.81 and fix every breaking change that touches `initPaymentSheet`, `presentPaymentSheet`, `StripeProvider`, Google Pay, or the config plugin.
- [ ] U5 (L3): decide on `react-native-get-random-values`. SDK 58 no longer pins it, and the app code calls only `Crypto.randomUUID()` from `expo-crypto`. Grep an `expo export` bundle for `getRandomValues`. If nothing calls it, remove the import in `app/_layout.tsx` and the dependency. If something does, keep it as a normal dependency at its latest version (2.1.0).
- [ ] U6 (L3): check the app config against the SDK 58 defaults. `web.output` is already `"static"` and the app has no API routes, so it needs no `apiRoutes`. Leave R8 on (the new default) and prove it with a release build in the device checklist. If a library breaks under R8, add its keep rule with `expo-build-properties`. Turning R8 off is a maintainer decision. `.env` loading: Expo CLI now forces `NODE_ENV`. The app has only `.env` (no `.env.test` or `.env.development`), so nothing changes.
- [ ] U7 (L5): bump `@react-native-google-signin/google-signin` 16 to 17 after reading its breaking changes (new native iOS SDK). It is not pinned by Expo, so it is a separate major and a separate commit. It can also move to a later item if U1 to U6 already fill the item.
- [ ] U8: run every check in "Verify the upgrade" below, then the device checklist on a new development build and on an Android release build.

After the upgrade (roadmap items #149 for A1 and #150 for A2, see L6):

- [ ] A1 (L5): migrate `@expo/vector-icons` to `@react-native-vector-icons/material-design-icons` with `npx @react-native-vector-icons/codemod` (static mode for development builds). The app uses only `MaterialCommunityIcons`, in 85 files plus 5 test mocks (`grep -rl "@expo/vector-icons" apps/frontend --include=*.ts --include=*.tsx | grep -v node_modules | wc -l`). Optional for SDK 58: Expo still ships and maintains the package. Do it before the `src/` move (#133), because both touch most screens.
- [ ] A2 (L5): migrate the 10 tests that use the deprecated `react-test-renderer` to `@testing-library/react-native` 14 (peer `test-renderer`).

## Verify the upgrade

These checks run in the upgrade worktree, from the repository root unless stated:

- `bun test`, `bun run lint`, `bun run typecheck` (zero errors).
- `bun audit --audit-level=high` with the `--ignore` list from `.github/workflows/dependency-audit.yml`. Review the `decode-uri-component` exception again (`docs/dependencies.md`): `expo-router` 58 may no longer pull `query-string` 7.
- From `apps/frontend`: `npx expo-doctor@latest`, `npx expo install --check`, `npx expo export --platform android` and `--platform ios`.
- Node: SDK 58 needs Node 22.13 or newer on the 22 line. Local Node is 22.19.0, and `eas.json` pins 22.13.1 in every profile.

## Device checklist

The maintainer runs this on a new development build from the upgrade worktree (`eas build --profile development` or `npx expo run:android|ios`). The SDK 57 development client cannot load the SDK 58 bundle. Items marked "release" need a release build (`eas build --profile preview`), because R8 runs only there.

1. Payment: a Stripe sandbox payment end to end through PaymentSheet, including the Google Pay sheet opening (Stripe 0.64 to 0.81). Also on the Android release build (R8).
2. Google Sign-In on Android and iOS. Also on the Android release build (R8).
3. hCaptcha on login or sign-up (`react-native-webview` 14).
4. OTP: the six-box code on `verify-code` and `resetPassword`. Type, paste, and the SMS or email code suggestion from the keyboard (P2).
5. Exit guard: in the sell flow, back and swipe back open the discard dialog. **Descartar** leaves and clears the draft. **Continuar editando** stays. Publishing leaves without the dialog (P3).
6. Back lock while generating a label in **Preparar envío** (`usePreventRemove`, U3).
7. Photo viewer on Android and iOS (product gallery, sell image picker, benchmark guide, Stripe onboarding screenshots): swipe between photos, pinch and double-tap zoom, swipe down closes, close button, counter. `react-native-zoom-toolkit` 5.1.1 was built against gesture-handler 2, and SDK 58 moves to gesture-handler 3.
8. Bottom sheets open, drag, and close (`@gorhom/bottom-sheet` on gesture-handler 3 and reanimated 4.7).
9. Price range filter in search: both thumbs drag and the values update (`@miblanchard/react-native-slider`, kept).
10. Animations: home sections, skeleton pulse, segmented control, checkout success (P1, Reanimated instead of `moti`).
11. Category cards in the shop show their image behind the text (P4).
12. Deep links: `selene://auth-verified` after email verification and `selene://sell/onboarding?return=1` after Stripe onboarding. On iOS this checks the new scene life cycle, which now delivers URLs.
13. Splash screen, tab bar cart badge and colors, biometric prompt, label share (`expo-file-system/legacy`), support email.
14. iOS 26 or later: screens with a native `Stack` header. SDK 58 makes the header transparent with Liquid Glass by default, so content can slide under it. If it does, add `contentInsetAdjustmentBehavior="automatic"` or set `headerTransparent: false` on that screen.
15. If push notifications (`feat/expo-push-notifications`) landed before the upgrade: a notification received with the app in the foreground. SDK 58 shows foreground notifications by default unless `setNotificationHandler` says otherwise.
16. Texts in Spanish and English on the screens above.

## Risks

| Risk | Where | Mitigation |
| --- | --- | --- |
| `react-native-zoom-toolkit` breaks on gesture-handler 3. Its docs promise a 6.x for newer RN that is not on npm. Issue Glazzes/react-native-zoom-toolkit#134 is open. | `components/ui/AppImageViewer.tsx` | Checklist item 7. `AppImageViewer` wraps it, so a replacement changes one file. |
| A library uses reflection and breaks under R8 in release builds only. | Stripe, Google Sign-In, hCaptcha | Release build in the checklist (items 1 and 2). Keep rules through `expo-build-properties`. |
| Stripe 0.64 to 0.81 changes PaymentSheet or Google Pay behavior. Seventeen minors below 1.0 can break on a minor. | `core/hooks/usePaymentProcess.ts`, checkout screens | U4 reads the changelog first. Checklist item 1. |
| The exit guard stops blocking, and a seller loses a listing draft. | `app/sell/_layout.tsx` | P3 lands on SDK 57 with a test, before the navigation core changes. Checklist item 5. |
| Strict TypeScript API types make the typecheck fail in third-party types (`react-native-paper`, Restyle). | typecheck | U2. If a library's own types fail, record it and pin the fix in the item. Do not use the deep-imports opt-out. |
| `@miblanchard/react-native-slider` has no release since 2024-03. | `PriceRangeFilter.tsx` | It is pure JS and its peers accept RN 0.88. Checklist item 9. Fallback: `react-native-smooth-range-slider` or a small two-thumb slider on gesture-handler and Reanimated. |
| `@gorhom/bottom-sheet` has no release since 2026-05. | 19 files | Peers accept gesture-handler 3 and reanimated 4. Checklist item 8. |
| The OTP autofill behaves differently per platform. | auth screens | Checklist item 4 on both platforms. |

## Log

- L1: "Tomá la sub-issue #128 del roadmap #127. Seguí docs/roadmaps.md: 1. Antes de empezar, comentá en #128 que la tomás, con el worktree y la rama. 2. Verificá que el ítem siga vigente (versiones del SDK 58, el estado de #99, el reporte #95). 3. Solo investigación y el documento odd/tasks/expo-sdk-58.md con tareas, riesgos y el checklist de dispositivo. Sin código. 4. Si descubrís pasos nuevos o un orden mejor, comentalo en #127 con el porqué. Las ideas que salgan van como issues \"Idea\", según AGENTS.md. 5. Rama nueva desde origin/main y un PR con Closes #128."
- L2: The item still holds (2026-10-31). npm: `expo@58.0.22` is `latest`, and `58.0.0` was published on 2026-09-29. The changelog post is dated 2026-10-15. `odd/tasks/expo-sdk-upgrade.md` L2 gives 2026-10-14, which is wrong. #99 is open, and all five packages are still in `apps/frontend/package.json` with no new release of `moti` (2025-01), the slider (2024-03), or the OTP input (2025-05). #95 (2026-10-30) recommends the upgrade (SDK 58 31 days old). Its majors table is partly wrong for the frontend, as #126 says. The SDK 58 pin list (`expo@58.0.22/bundledNativeModules.json`) keeps `@react-native-async-storage/async-storage` at 2.2.0 (the 3.x in #95 does not come with SDK 58), pins Stripe at 0.81.0 (not 0.83.0), and no longer lists `react-native-get-random-values`. The `expo-notifications` worktree has not installed `expo-notifications` yet (4 commits ahead of `main`, database work).
- L3: SDK 58 changes that reach the app (https://expo.dev/changelog/sdk-58 and the pin list diff between `expo@57.0.31` and `expo@58.0.22`): RN 0.88 with the Strict TypeScript API by default, and removals of `InteractionManager`, the `Touchable` root export, `Modal` `animated`, and the `StatusBar` `backgroundColor`, `translucent`, and `networkActivityIndicatorVisible` props. The app uses none of these. `ImageBackground` is deprecated (1 file). The iOS scene life cycle is mandatory, and prebuild generates it (the app uses CNG). R8 is on in Android release builds. Expo CLI forces `NODE_ENV`. `expo-file-system` `File.write()` is now async (the app uses only `expo-file-system/legacy` `downloadAsync`). `expo-notifications` shows foreground notifications by default. `Linking.parse()` stops decoding twice (the app uses `Linking.createURL` and `addEventListener` only). Node 22.13 or newer. New optional packages (`expo-hinge`, `expo-app-intents`) are not needed. Pin moves: gesture-handler 2.32 to 3.3 (the app uses only `GestureHandlerRootView`, which 3.x keeps), webview 13 to 14 (hCaptcha accepts `>=9.0.1`), Stripe 0.64 to 0.81 (peer `react-native-webview: *`).
- L4: Expo Router 57 to 58 (https://docs.expo.dev/router/migrate/sdk-57-to-58/). The app imports from `expo-router/react-navigation` in 6 files: `useFocusEffect`, `useScrollToTop`, `usePreventRemove`, `ThemeProvider`, `DarkTheme`, `Theme`. None is in the removed table. The guide imports `usePreventRemove` from `expo-router`. The `beforeRemove` event is removed, and `core/hooks/useExitGuard.tsx` with `core/utils/navigationGuard.ts` depends on it (P3). Not used in the app: `initialRouteName`, `freezeOnBlur`, `redirect`, `initialParams`, `expo-router/head`, `app/+html.tsx`, `navigationKey`, dispatch functions. `navigation.dispatch(action)` in `useExitGuard` goes away with P3.
- L5: Package decisions (research by a read-only subagent, spot-checked on npm on 2026-10-31). `moti`: replace with Reanimated 4. Its Reanimated 4 port (nandorojo/moti#389) is still open, and issue #391 reports broken animations on Reanimated 4.1. Slider: keep for SDK 58. No maintained library offers two thumbs with healthy maintenance: `@react-native-community/slider` 5.2.2 and `@expo/ui` `Slider` take one value, `react-native-awesome-slider` has one thumb, `rn-range-slider` is stale since 2022, and `react-native-smooth-range-slider` 1.0.4 has a single maintainer. OTP: in-house component. `react-native-otp-entry` 1.8.6 has an open autofill issue, and the in-house input is about 100 to 150 lines. `@expo/vector-icons`: Expo says it "will be deprecated" in a future SDK (https://expo.dev/blog/moving-away-from-expo-vector-icons, 2026-06-09). SDK 58 does not deprecate it, so the codemod is optional now (A1). `react-test-renderer`: deprecated by React. `@testing-library/react-native` 14.1.0 with `test-renderer` 1.3.1 replaces it (A2). `react-native-zoom-toolkit` 5.1.1 is the latest version. `@gorhom/bottom-sheet` 5.2.14 accepts gesture-handler `>=2.16.1` and reanimated `>=3.16.0 || >=4.0.0-`. `@react-native-google-signin/google-signin` 17.0.0 came out on 2026-10-29 (U7). `react-native-webview` is still a dependency because hCaptcha needs it, although `expo-sdk-upgrade.md` L15 records its removal. The auth work added it back later.
- L6: Plan changes proposed on #127. (1) #132 lists `@react-native-async-storage/async-storage` 3 as a major that moves with SDK 58. SDK 58 keeps it at 2.2.0, so that line is wrong. (2) #131 shrinks: the slider stays and `@expo/vector-icons` is optional. P3 (exit guard) and P4 (`ImageBackground`) can land on SDK 57 and make the upgrade smaller. `moti` alone is about 250 to 400 lines, so #131 keeps P1 and #148 takes P2 to P4. (3) Two new items after #132 and before #133: #149 (A1, vector icons codemod) and #150 (A2, tests off `react-test-renderer`). #127, #131, and #132 were updated to match.
