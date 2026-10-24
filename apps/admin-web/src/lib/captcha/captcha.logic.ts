/**
 * Provider-agnostic CAPTCHA contract (mirrors the mobile app). Auth calls only
 * know `getToken()`; the widget (hCaptcha today, Turnstile later) lives in
 * `useCaptcha.tsx`, which supplies a `CaptchaProviderHandle`.
 */

/** Codes double as `AuthError.code`, so server and local failures share one mapping. */
export const CAPTCHA_FAILED_CODE = 'captcha_failed';
export const CAPTCHA_CANCELLED_CODE = 'captcha_cancelled';

export type CaptchaErrorCode =
  | typeof CAPTCHA_FAILED_CODE
  | typeof CAPTCHA_CANCELLED_CODE;

export class CaptchaError extends Error {
  readonly code: CaptchaErrorCode;

  constructor(code: CaptchaErrorCode) {
    super(code);
    this.code = code;
    this.name = 'CaptchaError';
  }
}

export type CaptchaProviderHandle = {
  /** False when no site key is set: the login sends no token. */
  configured: boolean;
  /** Runs one challenge; resolves a single-use token or rejects `CaptchaError`. */
  request: () => Promise<string>;
};

export type CaptchaTokenSource = () => Promise<string | undefined>;

/** Long enough to solve an image challenge; a silent widget must not leave a spinner forever. */
export const CAPTCHA_TIMEOUT_MS = 120_000;

/**
 * Resolves `undefined` when CAPTCHA is not configured (works while the server
 * has it off) and fails closed when it is configured but no provider is mounted.
 */
export const createCaptchaGetter =
  (
    getProvider: () => CaptchaProviderHandle | null,
    timeoutMs: number = CAPTCHA_TIMEOUT_MS,
  ): CaptchaTokenSource =>
  async () => {
    const provider = getProvider();
    if (!provider) throw new CaptchaError(CAPTCHA_FAILED_CODE);
    if (!provider.configured) return undefined;
    return withTimeout(provider.request(), timeoutMs);
  };

/** Normalizes whatever a widget rejects with; hCaptcha rejects with strings like `challenge-closed`. */
export const toCaptchaError = (reason: unknown): CaptchaError => {
  if (reason instanceof CaptchaError) return reason;
  return new CaptchaError(
    reason === 'challenge-closed' ? CAPTCHA_CANCELLED_CODE : CAPTCHA_FAILED_CODE,
  );
};

const withTimeout = (request: Promise<string>, ms: number): Promise<string> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CaptchaError(CAPTCHA_FAILED_CODE)), ms);
  });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
};
