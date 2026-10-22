/**
 * @file core/utils/emailChange.ts
 * @description Pure helpers for the email-change flow (CONF-016).
 * Validation + payload for supabase.auth.updateUser({ email }).
 *
 * emailRedirectTo ensures the confirmation link opens the app
 * (deep link) rather than a localhost URL. Must match the
 * scheme configured in the Supabase dashboard (e.g. selene://).
 */

import { mapAuthErrorKey } from '../auth/authErrors.logic';

// Practical RFC-5322 subset: local@domain.tld where local and domain
// are non-empty and contain no whitespace / @ / double-dot.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailValidation = { ok: true } | { ok: false; errorKey: string };

export const validateEmail = (raw: string): EmailValidation => {
  const value = raw.trim();
  if (value.length === 0 || !EMAIL_REGEX.test(value)) {
    return { ok: false, errorKey: 'errors.invalidEmail' };
  }
  return { ok: true };
};

export const buildEmailUpdatePayload = (raw: string): { email: string } => ({
  email: raw.trim().toLowerCase(),
});

/**
 * Deep link URL the confirmation email redirects to.
 * Must match a valid redirect URL in the Supabase project settings
 * and the deep link scheme in app.json (expo.scheme).
 */
export const EMAIL_REDIRECT_URL = 'selene://profile/settings';

/**
 * GoTrue sends no email when the address is unchanged but still answers 200,
 * so an unchanged address is rejected before the request.
 */
export const isSameEmail = (
  raw: string,
  current: string | null | undefined,
): boolean =>
  !!current && buildEmailUpdatePayload(raw).email === current.trim().toLowerCase();

const EMAIL_CHANGE_KEYS: Record<string, string> = {
  email_exists: 'settings:errors.emailAlreadyTaken',
  user_already_exists: 'settings:errors.emailAlreadyTaken',
  email_address_invalid: 'settings:errors.invalidEmail',
};

/** Maps a GoTrue error code to an i18n key; never matches message text. */
export const mapEmailChangeErrorKey = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code in EMAIL_CHANGE_KEYS) {
    return EMAIL_CHANGE_KEYS[code];
  }
  return mapAuthErrorKey(error);
};
