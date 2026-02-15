import * as LocalAuthentication from 'expo-local-authentication';

type AuthResult =
  | { success: true; method: 'biometric' | 'none'; error?: undefined }
  | { success: false; method?: undefined; error: string };

export const authenticateAsync = async (
  reason: string = 'Confirma tu identidad',
): Promise<AuthResult> => {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      return { success: true, method: 'none' };
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel: 'Usar código',
      disableDeviceFallback: false,
    });

    if (result.success) {
      return { success: true, method: 'biometric' };
    } else {
      return { success: false, error: result.error };
    }
  } catch (error) {
    return { success: false, error: 'UNKNOWN_ERROR' };
  }
};
