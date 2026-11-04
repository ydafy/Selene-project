import { describe, expect, it } from 'bun:test';

import {
  isUsernameAvailable,
  validateRegisterUsername,
} from './registerUsername.logic';

type Result = { data: unknown; error: { message: string } | null };

const fakeClient = (result: Result, calls: unknown[][] = []) =>
  ({
    from: (table: string) => {
      calls.push(['from', table]);
      return {
        select: (columns: string) => {
          calls.push(['select', columns]);
          return {
            eq: (column: string, value: string) => {
              calls.push(['eq', column, value]);
              return {
                limit: async (n: number) => {
                  calls.push(['limit', n]);
                  return result;
                },
              };
            },
          };
        },
      };
    },
  }) as never;

describe('validateRegisterUsername', () => {
  it('accepts letters, digits, underscore and dot from 3 to 20 characters', () => {
    expect(validateRegisterUsername('abc')).toEqual({ ok: true });
    expect(validateRegisterUsername('Maria_F.99')).toEqual({ ok: true });
    expect(validateRegisterUsername('a'.repeat(20))).toEqual({ ok: true });
  });

  it('rejects empty, short, long and invalid-charset values with settings keys', () => {
    expect(validateRegisterUsername('')).toEqual({
      ok: false,
      errorKey: 'settings:errors.usernameRequired',
    });
    expect(validateRegisterUsername('ab')).toEqual({
      ok: false,
      errorKey: 'settings:errors.usernameTooShort',
    });
    expect(validateRegisterUsername('a'.repeat(21))).toEqual({
      ok: false,
      errorKey: 'settings:errors.usernameTooLong',
    });
    expect(validateRegisterUsername('hola mundo')).toEqual({
      ok: false,
      errorKey: 'settings:errors.usernameInvalid',
    });
  });

  it('trims before validating, like signUp does', () => {
    expect(validateRegisterUsername('  abc  ')).toEqual({ ok: true });
  });
});

describe('isUsernameAvailable', () => {
  it('is available when no profile has the exact trimmed username', async () => {
    const calls: unknown[][] = [];
    const out = await isUsernameAvailable(
      fakeClient({ data: [], error: null }, calls),
      ' maria ',
    );
    expect(out).toBe('available');
    expect(calls).toEqual([
      ['from', 'profiles'],
      ['select', 'id'],
      ['eq', 'username', 'maria'],
      ['limit', 1],
    ]);
  });

  it('is taken when a profile already has it', async () => {
    const out = await isUsernameAvailable(
      fakeClient({ data: [{ id: 'x' }], error: null }),
      'maria',
    );
    expect(out).toBe('taken');
  });

  it('is unknown when the lookup fails, so the server stays the authority', async () => {
    const out = await isUsernameAvailable(
      fakeClient({ data: null, error: { message: 'network' } }),
      'maria',
    );
    expect(out).toBe('unknown');
  });
});
