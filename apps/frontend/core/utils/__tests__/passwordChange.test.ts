import { expect, test, describe } from 'bun:test';
import {
  validatePasswordChange,
  generatePasswordNonce,
  buildPasswordUpdatePayload,
} from '../passwordChange';

/**
 * Covers EXTD-TASK-009 + CONF-017: validation, nonce generation, payload.
 */
describe('validatePasswordChange', () => {
  test('accepts when new === confirm and >= 8 chars', () => {
    expect(
      validatePasswordChange('oldpw1234', 'newpw1234', 'newpw1234'),
    ).toEqual({ ok: true });
  });

  test('rejects missing current password', () => {
    expect(
      validatePasswordChange('', 'newpw1234', 'newpw1234'),
    ).toEqual({ ok: false, errorKey: 'errors.usernameRequired' });
  });

  test('rejects new password shorter than 8', () => {
    expect(
      validatePasswordChange('oldpw1234', 'short', 'short'),
    ).toEqual({ ok: false, errorKey: 'security.passwordTooShort' });
  });

  test('rejects new !== confirm', () => {
    expect(
      validatePasswordChange('oldpw1234', 'newpw1234', 'differentpw'),
    ).toEqual({ ok: false, errorKey: 'security.passwordMismatch' });
  });

  test('rejects exactly 7 chars (boundary)', () => {
    expect(
      validatePasswordChange('oldpw1234', '1234567', '1234567'),
    ).toEqual({ ok: false, errorKey: 'security.passwordTooShort' });
  });

  test('accepts exactly 8 chars (boundary)', () => {
    expect(
      validatePasswordChange('oldpw1234', '12345678', '12345678'),
    ).toEqual({ ok: true });
  });
});

describe('generatePasswordNonce', () => {
  test('returns a non-empty string', () => {
    const nonce = generatePasswordNonce();
    expect(typeof nonce).toBe('string');
    expect(nonce.length).toBeGreaterThan(0);
  });

  test('produces distinct values on repeated calls', () => {
    const a = generatePasswordNonce();
    const b = generatePasswordNonce();
    const c = generatePasswordNonce();
    expect(new Set([a, b, c]).size).toBe(3);
  });

  test('nonce is at least 16 chars (entropy floor)', () => {
    expect(generatePasswordNonce().length).toBeGreaterThanOrEqual(16);
  });
});

describe('buildPasswordUpdatePayload', () => {
  test('includes password and nonce', () => {
    const payload = buildPasswordUpdatePayload('newpw1234', 'nonce-abc');
    expect(payload).toEqual({ password: 'newpw1234', nonce: 'nonce-abc' });
  });
});
