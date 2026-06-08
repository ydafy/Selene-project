/**
 * @file core/utils/emailChange.ts
 * @description Pure helpers for the email-change flow (CONF-016).
 * Validation + payload for supabase.auth.updateUser({ email }).
 *
 * emailRedirectTo ensures the confirmation link opens the app
 * (deep link) rather than a localhost URL. Must match the
 * scheme configured in the Supabase dashboard (e.g. selene://).
 */

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
