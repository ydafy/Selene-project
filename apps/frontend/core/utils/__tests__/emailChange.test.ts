import { expect, test, describe } from 'bun:test';
import {
  validateEmail,
  buildEmailUpdatePayload,
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
