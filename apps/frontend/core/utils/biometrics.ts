import * as LocalAuthentication from 'expo-local-authentication';

type AuthResult =
  | { success: true; method: 'biometric' | 'none'; error?: undefined }
  | { success: false; method?: undefined; error: string };

export const authenticateAsync = async (
  reason: string = 'Confirm your identity',
): Promise<AuthResult> => {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      return { success: true, method: 'none' };
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false,
    });

    if (result.success) {
      return { success: true, method: 'biometric' };
    }
    return { success: false, error: result.error };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    console.error('[BIOMETRICS]', error);
    return { success: false, error: message };
  }
};
