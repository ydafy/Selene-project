/**
 * @file core/auth/captcha/captcha.logic.ts
 * @description Provider-agnostic CAPTCHA contract. Auth calls only know
 * `getCaptchaToken()`; the widget (hCaptcha today, Turnstile later) lives in
 * the provider component that registers itself as a `CaptchaProviderHandle`.
 */

/** Codes double as `AuthError.code`, so `mapAuthErrorKey` localizes them. */
export const CAPTCHA_FAILED_CODE = 'captcha_failed';
export const CAPTCHA_CANCELLED_CODE = 'captcha_cancelled';

export type CaptchaErrorCode =
  | typeof CAPTCHA_FAILED_CODE
  | typeof CAPTCHA_CANCELLED_CODE;

export class CaptchaError extends Error {
  constructor(readonly code: CaptchaErrorCode) {
    super(code);
    this.name = 'CaptchaError';
  }
}

export type CaptchaProviderHandle = {
  /** False when no site key is set: the app sends no token. */
  configured: boolean;
  /** Runs one challenge; resolves a single-use token or rejects `CaptchaError`. */
  request: () => Promise<string>;
};

export type CaptchaTokenSource = () => Promise<string | undefined>;

/**
 * Builds the token source the auth calls await right before Supabase. It
 * resolves `undefined` when CAPTCHA is not configured (works while the server
 * has it off) and fails closed when it is configured but no provider is mounted.
 */
export const createCaptchaGetter =
  (
    getProvider: () => CaptchaProviderHandle | null,
  ): CaptchaTokenSource =>
  async () => {
    const provider = getProvider();
    if (!provider) throw new CaptchaError(CAPTCHA_FAILED_CODE);
    if (!provider.configured) return undefined;
    return provider.request();
  };
