/**
 * @file core/utils/emailChange.ts
 * @description Pure helpers for the email-change flow (CONF-016).
 * Validation + payload for supabase.auth.updateUser({ email }).
 */

// Practical RFC-5322 subset: local@domain.tld where local and domain
// are non-empty and contain no whitespace / @ / double-dot.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailValidation =
  | { ok: true }
  | { ok: false; errorKey: string };

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
