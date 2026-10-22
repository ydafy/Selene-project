import { expect, test, describe } from 'bun:test';
import {
  validateEmail,
  buildEmailUpdatePayload,
  isSameEmail,
  mapEmailChangeErrorKey,
} from '../emailChange';

/**
 * Covers EXTD-TASK-007 (CONF-016): email validation + auth.updateUser payload.
 */
describe('validateEmail', () => {
  test('accepts standard address', () => {
    expect(validateEmail('john@example.com')).toEqual({ ok: true });
  });

  test('accepts plus addressing', () => {
    expect(validateEmail('john+tag@example.co.uk')).toEqual({ ok: true });
  });

  test('rejects empty string', () => {
    expect(validateEmail('')).toEqual({
      ok: false,
      errorKey: 'errors.invalidEmail',
    });
  });

  test('rejects whitespace only', () => {
    expect(validateEmail('   ')).toEqual({
      ok: false,
      errorKey: 'errors.invalidEmail',
    });
  });

  test('rejects missing @', () => {
    expect(validateEmail('johnexample.com')).toEqual({
      ok: false,
      errorKey: 'errors.invalidEmail',
    });
  });

  test('rejects missing domain', () => {
    expect(validateEmail('john@')).toEqual({
      ok: false,
      errorKey: 'errors.invalidEmail',
    });
  });

  test('rejects double @', () => {
    expect(validateEmail('john@@example.com')).toEqual({
      ok: false,
      errorKey: 'errors.invalidEmail',
    });
  });
});

describe('buildEmailUpdatePayload', () => {
  test('returns { email } for valid input', () => {
    expect(buildEmailUpdatePayload('john@example.com')).toEqual({
      email: 'john@example.com',
    });
  });

  test('trims surrounding whitespace', () => {
    expect(buildEmailUpdatePayload('  john@example.com  ')).toEqual({
      email: 'john@example.com',
    });
  });

  test('lowercases the address', () => {
    expect(buildEmailUpdatePayload('John@Example.COM')).toEqual({
      email: 'john@example.com',
    });
  });
});

/**
 * Auth block 4 (S7, C4, C5): error codes instead of message text, and an
 * unchanged address is rejected before GoTrue silently skips the email.
 */
describe('isSameEmail', () => {
  test('matches the current address after trim and lowercase', () => {
    expect(isSameEmail('  Buyer@Selene.local ', 'buyer@selene.local')).toBe(true);
  });

  test('a different address is not the same', () => {
    expect(isSameEmail('new@selene.local', 'buyer@selene.local')).toBe(false);
  });

  test('no current address is never the same', () => {
    expect(isSameEmail('new@selene.local', null)).toBe(false);
  });
});

describe('mapEmailChangeErrorKey', () => {
  test.each([
    ['email_exists', 'settings:errors.emailAlreadyTaken'],
    ['user_already_exists', 'settings:errors.emailAlreadyTaken'],
    ['email_address_invalid', 'settings:errors.invalidEmail'],
    ['over_email_send_rate_limit', 'auth:errors.rateLimited'],
  ])('maps %s to %s', (code, key) => {
    expect(mapEmailChangeErrorKey({ name: 'AuthApiError', code })).toBe(key);
  });

  test('maps a network failure to the network message', () => {
    expect(
      mapEmailChangeErrorKey({ name: 'AuthRetryableFetchError', status: 0 }),
    ).toBe('auth:errors.network');
  });

  test('never matches on the raw message text', () => {
    expect(
      mapEmailChangeErrorKey({ message: 'A user with this email already exists' }),
    ).toBe('common:errors.generic');
  });
});
