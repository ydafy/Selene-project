/**
 * Google Pay runs in the test environment unless the publishable key is live,
 * so a live build never uses the test environment (#27).
 */
export const googlePayTestEnv = (publishableKey: string | undefined): boolean =>
  !publishableKey?.startsWith('pk_live_');
