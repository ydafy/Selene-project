import { expect, test, describe } from 'bun:test';
import {
  validatePasswordChange,
  buildPasswordUpdatePayload,
  mapPasswordChangeErrorKey,
  passwordErrorField,
  type PasswordField,
} from '../passwordChange';

/**
 * Covers CONF-017 and auth block 4 (S7, L54): the current password proves the
 * user's identity and travels as GoTrue's `current_password` field.
 */
describe('validatePasswordChange', () => {
  test('accepts current + new === confirm and >= 8 chars', () => {
    expect(validatePasswordChange('oldpw123', 'newpw1234', 'newpw1234')).toEqual({
      ok: true,
    });
  });

  test('rejects an empty current password', () => {
    expect(validatePasswordChange('', 'newpw1234', 'newpw1234')).toEqual({
      ok: false,
      errorKey: 'security.currentPasswordRequired',
    });
  });

  test('rejects new password shorter than 8', () => {
    expect(validatePasswordChange('oldpw123', 'short', 'short')).toEqual({
      ok: false,
      errorKey: 'security.passwordTooShort',
    });
  });

  test('rejects new !== confirm', () => {
    expect(
      validatePasswordChange('oldpw123', 'newpw1234', 'differentpw'),
    ).toEqual({ ok: false, errorKey: 'security.passwordMismatch' });
  });

  test('rejects a new password equal to the current one', () => {
    expect(
      validatePasswordChange('samepw123', 'samepw123', 'samepw123'),
    ).toEqual({ ok: false, errorKey: 'security.samePassword' });
  });

  test('rejects exactly 7 chars (boundary)', () => {
    expect(validatePasswordChange('oldpw123', '1234567', '1234567')).toEqual({
      ok: false,
      errorKey: 'security.passwordTooShort',
    });
  });

  test('accepts exactly 8 chars (boundary)', () => {
    expect(validatePasswordChange('oldpw123', '12345678', '12345678')).toEqual({
      ok: true,
    });
  });
});

describe('buildPasswordUpdatePayload', () => {
  test('sends the new password and current_password, never a nonce', () => {
    expect(buildPasswordUpdatePayload('oldpw123', 'newpw1234')).toEqual({
      password: 'newpw1234',
      current_password: 'oldpw123',
    });
  });
});

describe('mapPasswordChangeErrorKey', () => {
  test.each([
    ['current_password_invalid', 'settings:errors.wrongPassword'],
    ['current_password_required', 'settings:errors.wrongPassword'],
    ['same_password', 'settings:security.samePassword'],
    ['reauthentication_needed', 'settings:security.recentLoginRequired'],
    ['reauthentication_not_valid', 'settings:security.recentLoginRequired'],
    ['weak_password', 'auth:errors.weakPassword'],
    ['over_request_rate_limit', 'auth:errors.rateLimited'],
  ])('maps %s to %s', (code, key) => {
    expect(mapPasswordChangeErrorKey({ name: 'AuthApiError', code })).toBe(key);
  });

  test('maps a network failure to the network message', () => {
    expect(
      mapPasswordChangeErrorKey({ name: 'AuthRetryableFetchError', status: 0 }),
    ).toBe('auth:errors.network');
  });

  test('a code named like an Object prototype key falls back to generic', () => {
    expect(mapPasswordChangeErrorKey({ code: 'constructor' })).toBe(
      'common:errors.generic',
    );
  });

  test('never matches on the raw message text', () => {
    expect(
      mapPasswordChangeErrorKey({ message: 'Invalid password, wrong input' }),
    ).toBe('common:errors.generic');
  });
});

describe('passwordErrorField (L62: the error shows under the field that failed)', () => {
  test.each<[string, PasswordField]>([
    ['security.currentPasswordRequired', 'current'],
    ['settings:errors.wrongPassword', 'current'],
    ['security.passwordTooShort', 'new'],
    ['security.samePassword', 'new'],
    ['settings:security.samePassword', 'new'],
    ['auth:errors.weakPassword', 'new'],
    ['security.passwordMismatch', 'confirm'],
    ['auth:errors.network', 'form'],
    ['settings:security.recentLoginRequired', 'form'],
    ['common:errors.generic', 'form'],
  ])('%s belongs to %s', (key, field) => {
    expect(passwordErrorField(key)).toBe(field);
  });
});
