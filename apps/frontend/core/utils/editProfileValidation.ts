/**
 * @file core/utils/editProfileValidation.ts
 * @description Pure validator for the /profile/edit modal username field.
 * Covers CONF-015. Regex matches the existing AccountSection rule
 * (letters, digits, underscore, dot) and length 3..30 per the new modal spec.
 */

const USERNAME_REGEX = /^[A-Za-z0-9_.]+$/;
const MIN_LEN = 3;
const MAX_LEN = 30;

export type UsernameValidation =
  | { ok: true }
  | { ok: false; errorKey: string };

export const validateEditUsername = (raw: string): UsernameValidation => {
  const value = raw.trim();

  if (value.length === 0) {
    return { ok: false, errorKey: 'errors.usernameRequired' };
  }
  if (value.length < MIN_LEN) {
    return { ok: false, errorKey: 'errors.usernameTooShort' };
  }
  if (value.length > MAX_LEN) {
    return { ok: false, errorKey: 'errors.usernameTooLong' };
  }
  if (!USERNAME_REGEX.test(value)) {
    return { ok: false, errorKey: 'errors.usernameInvalid' };
  }
  return { ok: true };
};
