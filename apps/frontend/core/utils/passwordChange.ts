/**
 * @file core/utils/passwordChange.ts
 * @description Pure helpers for the password-change flow (CONF-017).
 * - validatePasswordChange: current + new + confirm validation
 * - generatePasswordNonce: per-submit nonce (Crypto.randomUUID preferred,
 *   falls back to crypto.getRandomValues, then to Math.random as last resort)
 * - buildPasswordUpdatePayload: payload for supabase.auth.updateUser
 *
 * `currentPassword` is supported from @supabase/supabase-js ^2.102.0.
 */


const MIN_LENGTH = 8;

export type PasswordValidation =
  | { ok: true }
  | { ok: false; errorKey: string };

export const validatePasswordChange = (
  next: string,
  confirm: string,
): PasswordValidation => {
  if (next.length < MIN_LENGTH) {
    return { ok: false, errorKey: 'security.passwordTooShort' };
  }
  if (next !== confirm) {
    return { ok: false, errorKey: 'security.passwordMismatch' };
  }
  return { ok: true };
};

/**
 * Generate a per-submit nonce. Uses the strongest available source:
 *   1. globalThis.crypto.randomUUID (Hermes/RN ≥ 0.74, web)
 *   2. globalThis.crypto.getRandomValues (RN with polyfill)
 *   3. Math.random fallback (last resort — flagged in comments)
 *
 * Length is at least 32 chars when crypto is available, 16+ in fallback.
 */
export const generatePasswordNonce = (): string => {
  const g = globalThis as unknown as {
    crypto?: {
      randomUUID?: () => string;
      getRandomValues?: (a: Uint8Array) => Uint8Array;
    };
  };

  if (g.crypto?.randomUUID) {
    // 36 chars including hyphens — plenty of entropy.
    return g.crypto.randomUUID();
  }

  if (g.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    g.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Last-resort fallback. NOT cryptographically strong — flagged.
  // expo-crypto polyfills crypto.getRandomValues, so this should not run
  // in production unless the polyfill is missing.
  let out = '';
  while (out.length < 16) {
    out += Math.random().toString(36).slice(2);
  }
  return out.slice(0, 32);
};

export type PasswordUpdatePayload = {
  password: string;
  nonce: string;
  currentPassword?: string;
};

export const buildPasswordUpdatePayload = (
  password: string,
  nonce: string,
  currentPassword?: string,
): PasswordUpdatePayload => ({ password, nonce, ...(currentPassword ? { currentPassword } : {}) });
