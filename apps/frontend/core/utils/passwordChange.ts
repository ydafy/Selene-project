/**
 * @file core/utils/passwordChange.ts
 * @description Pure helpers for the password-change flow (CONF-017, auth block 4).
 * - validatePasswordChange: current + new + confirm validation
 * - buildPasswordUpdatePayload: payload for supabase.auth.updateUser
 * - mapPasswordChangeErrorKey: GoTrue error code -> i18n key
 *
 * The current password proves the user's identity: GoTrue checks
 * `current_password` when "Require current password" is on (it skips the
 * check in recovery sessions). auth-js forwards the attributes as the request
 * body, so the field must use GoTrue's snake_case name.
 */

import { mapAuthErrorKey } from '../auth/authErrors.logic';

const MIN_LENGTH = 8;

export type PasswordValidation =
  | { ok: true }
  | { ok: false; errorKey: string };

export const validatePasswordChange = (
  current: string,
  next: string,
  confirm: string,
): PasswordValidation => {
  if (current.length === 0) {
    return { ok: false, errorKey: 'security.currentPasswordRequired' };
  }
  if (next.length < MIN_LENGTH) {
    return { ok: false, errorKey: 'security.passwordTooShort' };
  }
  if (next !== confirm) {
    return { ok: false, errorKey: 'security.passwordMismatch' };
  }
  if (next === current) {
    return { ok: false, errorKey: 'security.samePassword' };
  }
  return { ok: true };
};

export type PasswordUpdatePayload = {
  password: string;
  current_password: string;
};

export const buildPasswordUpdatePayload = (
  currentPassword: string,
  password: string,
): PasswordUpdatePayload => ({ password, current_password: currentPassword });

const PASSWORD_CHANGE_KEYS: Record<string, string> = {
  current_password_invalid: 'settings:errors.wrongPassword',
  current_password_required: 'settings:errors.wrongPassword',
  same_password: 'settings:security.samePassword',
  // Only reachable while "Secure password change" is on: a fresh sign-in
  // makes the session recent enough for GoTrue.
  reauthentication_needed: 'settings:security.recentLoginRequired',
  reauthentication_not_valid: 'settings:security.recentLoginRequired',
};

export const mapPasswordChangeErrorKey = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code in PASSWORD_CHANGE_KEYS) {
    return PASSWORD_CHANGE_KEYS[code];
  }
  return mapAuthErrorKey(error);
};
