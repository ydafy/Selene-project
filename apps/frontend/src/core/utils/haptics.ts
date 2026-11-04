import type * as HapticsType from 'expo-haptics';

type HapticsModule = typeof HapticsType;

let nativeHaptics: HapticsModule | null | undefined;

const getNativeHaptics = (): HapticsModule | null | undefined => {
  if (nativeHaptics === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      nativeHaptics = require('expo-haptics');
    } catch {
      nativeHaptics = null;
    }
  }
  return nativeHaptics;
};

/**
 * Lightweight cross-platform haptic trigger.
 *
 * `expo-haptics` is a no-op on Android/web, but we still guard against
 * unexpected errors so a haptics failure never blocks user flow.
 *
 * The optional `impl` parameter is used for testing; production callers
 * should leave it undefined so the real expo-haptics module is lazy-loaded.
 */
export const triggerHaptic = async (
  style?: HapticsType.ImpactFeedbackStyle,
  impl?: HapticsModule,
): Promise<void> => {
  const haptics = impl ?? getNativeHaptics();
  if (!haptics) return;

  const feedbackStyle = style ?? haptics.ImpactFeedbackStyle.Light;
  try {
    await haptics.impactAsync(feedbackStyle);
  } catch {
    // Ignore haptics errors on unsupported platforms or in test environments.
  }
};
