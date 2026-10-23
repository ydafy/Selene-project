/**
 * @file core/auth/authErrors.logic.ts
 * @description Pure mapping from Supabase Auth errors to i18n keys, so no raw
 * server message ever reaches a toast. Codes come from the installed
 * `@supabase/auth-js` (`src/lib/error-codes.ts`).
 */

export const GENERIC_ERROR_KEY = 'common:errors.generic';
export const USERNAME_TAKEN_KEY = 'auth:errors.usernameAlreadyTaken';
export const ACCOUNT_EXISTS_KEY = 'auth:accountAlreadyExistsMsg';
export const NETWORK_ERROR_KEY = 'auth:errors.network';

const CODE_KEYS: Record<string, string> = {
  invalid_credentials: 'auth:errors.invalidCredentials',
  email_not_confirmed: 'auth:errors.emailNotConfirmed',
  user_already_exists: ACCOUNT_EXISTS_KEY,
  email_exists: ACCOUNT_EXISTS_KEY,
  weak_password: 'auth:errors.weakPassword',
  over_email_send_rate_limit: 'auth:errors.rateLimited',
  over_request_rate_limit: 'auth:errors.rateLimited',
  otp_expired: 'auth:errors.otpExpired',
  validation_failed: 'auth:errors.validationFailed',
  email_address_invalid: 'auth:errors.invalidEmail',
  signup_disabled: 'auth:errors.signupDisabled',
};

const RATE_LIMIT_CODES = ['over_email_send_rate_limit', 'over_request_rate_limit'];

type ErrorFields = {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

const fieldsOf = (error: unknown): ErrorFields =>
  typeof error === 'object' && error !== null ? (error as ErrorFields) : {};

/**
 * The signup trigger raises `Username "x" is already taken` (23505). GoTrue
 * answers HTTP 500 with that text, and auth-js wraps every 500 as an
 * `AuthRetryableFetchError` that keeps the status but drops the SQLSTATE and
 * has no `code`. The exact trigger text on a code-less 500 is the only signal.
 */
const TAKEN_USERNAME_MESSAGE = /^Username ".*" is already taken$/;

const isTriggerUsernameRejection = ({ code, message, status }: ErrorFields) =>
  status === 500 &&
  !code &&
  typeof message === 'string' &&
  TAKEN_USERNAME_MESSAGE.test(message);

const isNetworkFailure = ({ name, message, status }: ErrorFields) =>
  (name === 'AuthRetryableFetchError' && !status) ||
  (name === 'TypeError' &&
    typeof message === 'string' &&
    /network request failed|failed to fetch/i.test(message));

export const mapAuthErrorKey = (error: unknown): string => {
  const fields = fieldsOf(error);
  if (typeof fields.code === 'string' && Object.hasOwn(CODE_KEYS, fields.code)) {
    return CODE_KEYS[fields.code];
  }
  if (isTriggerUsernameRejection(fields)) return USERNAME_TAKEN_KEY;
  if (isNetworkFailure(fields)) return NETWORK_ERROR_KEY;
  return GENERIC_ERROR_KEY;
};

export const isRateLimitError = (error: unknown): boolean => {
  const { code } = fieldsOf(error);
  return typeof code === 'string' && RATE_LIMIT_CODES.includes(code);
};
