# Dependency patches

Applied by bun on install through `patchedDependencies` in the root `package.json`.
Each patch fixes a dependency we cannot upgrade yet; remove it with the dependency.

| Patch | Why | Remove when |
| --- | --- | --- |
| `react-native-image-viewing@0.2.2.patch` | React Native 0.85 removed `StyleSheet.absoluteFillObject`; the Android modal spread it and lost its full-screen layout. Uses `StyleSheet.absoluteFill`. Guarded by `apps/frontend/tests/dependencies/image-viewing-patch.test.ts`. | The library (unmaintained since 2022) is replaced, before the SDK 58 upgrade. |
