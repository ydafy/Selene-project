import { describe, expect, it } from 'bun:test';

import {
  ACCOUNT_EXISTS_KEY,
  GENERIC_ERROR_KEY,
  USERNAME_TAKEN_KEY,
  isRateLimitError,
  mapAuthErrorKey,
} from './authErrors.logic';

const apiError = (code: string, message = 'Raw English message', status = 400) => ({
  name: 'AuthApiError',
  code,
  message,
  status,
});

describe('mapAuthErrorKey', () => {
  const cases: [string, string][] = [
    ['invalid_credentials', 'auth:errors.invalidCredentials'],
    ['email_not_confirmed', 'auth:errors.emailNotConfirmed'],
    ['user_already_exists', ACCOUNT_EXISTS_KEY],
    ['email_exists', ACCOUNT_EXISTS_KEY],
    ['weak_password', 'auth:errors.weakPassword'],
    ['over_email_send_rate_limit', 'auth:errors.rateLimited'],
    ['over_request_rate_limit', 'auth:errors.rateLimited'],
    ['otp_expired', 'auth:errors.otpExpired'],
    ['validation_failed', 'auth:errors.validationFailed'],
    ['email_address_invalid', 'auth:errors.invalidEmail'],
    ['signup_disabled', 'auth:errors.signupDisabled'],
  ];

  for (const [code, key] of cases) {
    it(`maps ${code} to ${key}`, () => {
      expect(mapAuthErrorKey(apiError(code))).toBe(key);
    });
  }

  it('maps an unknown code to the generic key', () => {
    expect(mapAuthErrorKey(apiError('something_new'))).toBe(GENERIC_ERROR_KEY);
  });

  it('maps null, undefined and plain values to the generic key', () => {
    expect(mapAuthErrorKey(null)).toBe(GENERIC_ERROR_KEY);
    expect(mapAuthErrorKey(undefined)).toBe(GENERIC_ERROR_KEY);
    expect(mapAuthErrorKey('boom')).toBe(GENERIC_ERROR_KEY);
  });

  it('maps a dropped connection (retryable fetch error, status 0) to the network key', () => {
    expect(
      mapAuthErrorKey({
        name: 'AuthRetryableFetchError',
        message: 'Network request failed',
        status: 0,
      }),
    ).toBe('auth:errors.network');
  });

  it('maps a fetch TypeError to the network key', () => {
    expect(mapAuthErrorKey(new TypeError('Network request failed'))).toBe(
      'auth:errors.network',
    );
  });

  it('maps the signup trigger rejection (500, no code, taken text) to the username key', () => {
    expect(
      mapAuthErrorKey({
        name: 'AuthRetryableFetchError',
        message: 'Username "selene_admin" is already taken',
        status: 500,
      }),
    ).toBe(USERNAME_TAKEN_KEY);
  });

  it('keeps other 500 responses generic, never the taken-username key', () => {
    expect(
      mapAuthErrorKey({
        name: 'AuthRetryableFetchError',
        message: 'Database error saving new user',
        status: 500,
      }),
    ).toBe(GENERIC_ERROR_KEY);
    expect(
      mapAuthErrorKey({
        name: 'AuthRetryableFetchError',
        message: 'Username must be between 3 and 20 characters',
        status: 500,
      }),
    ).toBe(GENERIC_ERROR_KEY);
  });

  it('does not treat the taken text on a non-500 error as the trigger rejection', () => {
    expect(
      mapAuthErrorKey({
        name: 'AuthApiError',
        message: 'Username "x" is already taken',
        status: 422,
      }),
    ).toBe(GENERIC_ERROR_KEY);
  });

  it('always returns a key, never the raw server message', () => {
    for (const error of [
      apiError('invalid_credentials', 'Invalid login credentials'),
      apiError('unknown_thing', 'Totally raw English text'),
      new Error('Totally raw English text'),
    ]) {
      const key = mapAuthErrorKey(error);
      expect(key).toMatch(/^(auth|common):errors\.[A-Za-z]+$/);
      expect(key).not.toContain('raw');
    }
  });
});

describe('isRateLimitError', () => {
  it('is true for both rate limit codes', () => {
    expect(isRateLimitError(apiError('over_email_send_rate_limit'))).toBe(true);
    expect(isRateLimitError(apiError('over_request_rate_limit'))).toBe(true);
  });

  it('is false for other errors and null', () => {
    expect(isRateLimitError(apiError('otp_expired'))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});

describe('mapAuthErrorKey prototype keys', () => {
  it('a code named like an Object prototype key falls back to generic', () => {
    expect(mapAuthErrorKey({ code: 'constructor' })).toBe(GENERIC_ERROR_KEY);
    expect(mapAuthErrorKey({ code: '__proto__' })).toBe(GENERIC_ERROR_KEY);
  });
});
