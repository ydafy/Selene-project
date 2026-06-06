import { expect, test, describe } from 'bun:test';
import { validateEditUsername } from '../editProfileValidation';

/**
 * Covers CONF-015 + EXTD-TASK-011: username regex ^[A-Za-z0-9_.]+$ and
 * length 3..30 (spec text says 3..30, prior settings says 3..20 — we use
 * 3..30 here as the spec is authoritative for the new modal).
 */
describe('validateEditUsername', () => {
  test('accepts valid username with letters', () => {
    expect(validateEditUsername('john')).toEqual({ ok: true });
  });

  test('accepts username with digits + underscore + dot', () => {
    expect(validateEditUsername('john_doe.99')).toEqual({ ok: true });
  });

  test('rejects empty string with required key', () => {
    expect(validateEditUsername('')).toEqual({
      ok: false,
      errorKey: 'errors.usernameRequired',
    });
  });

  test('rejects whitespace-only with required key', () => {
    expect(validateEditUsername('   ')).toEqual({
      ok: false,
      errorKey: 'errors.usernameRequired',
    });
  });

  test('rejects username shorter than 3 chars', () => {
    expect(validateEditUsername('ab')).toEqual({
      ok: false,
      errorKey: 'errors.usernameTooShort',
    });
  });

  test('rejects username longer than 30 chars', () => {
    expect(validateEditUsername('a'.repeat(31))).toEqual({
      ok: false,
      errorKey: 'errors.usernameTooLong',
    });
  });

  test('rejects forbidden chars (space)', () => {
    expect(validateEditUsername('john doe')).toEqual({
      ok: false,
      errorKey: 'errors.usernameInvalid',
    });
  });

  test('rejects forbidden chars (hyphen)', () => {
    expect(validateEditUsername('john-doe')).toEqual({
      ok: false,
      errorKey: 'errors.usernameInvalid',
    });
  });

  test('rejects emojis / unicode', () => {
    expect(validateEditUsername('john😀')).toEqual({
      ok: false,
      errorKey: 'errors.usernameInvalid',
    });
  });

  test('trims surrounding whitespace before checking length', () => {
    expect(validateEditUsername('  jo  ')).toEqual({
      ok: false,
      errorKey: 'errors.usernameTooShort',
    });
  });
});
