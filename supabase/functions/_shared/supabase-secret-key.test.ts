import { describe, expect, it, spyOn } from 'bun:test';
import { readSupabaseSecretKey } from './supabase-secret-key';

const KEY = 'sb_secret_abc123';

const envWith =
  (value: string | undefined) =>
  (name: string): string | undefined =>
    name === 'SUPABASE_SECRET_KEYS' ? value : undefined;

describe('readSupabaseSecretKey', () => {
  it('returns the default secret key from SUPABASE_SECRET_KEYS', () => {
    expect(
      readSupabaseSecretKey(
        envWith(JSON.stringify({ default: KEY, other: 'sb_secret_x' })),
      ),
    ).toBe(KEY);
  });

  it('reads only SUPABASE_SECRET_KEYS, never the legacy variables', () => {
    const names: string[] = [];
    readSupabaseSecretKey((name) => {
      names.push(name);
      return JSON.stringify({ default: KEY });
    });
    expect(names).toEqual(['SUPABASE_SECRET_KEYS']);
  });

  it('returns nothing when the variable is missing or empty', () => {
    expect(readSupabaseSecretKey(envWith(undefined))).toBeUndefined();
    expect(readSupabaseSecretKey(envWith(''))).toBeUndefined();
  });

  it('returns nothing for invalid JSON', () => {
    expect(readSupabaseSecretKey(envWith('{default:'))).toBeUndefined();
    expect(readSupabaseSecretKey(envWith(KEY))).toBeUndefined();
  });

  it('returns nothing when the JSON is not an object', () => {
    for (const value of ['null', '"sb_secret_abc"', '42', `["${KEY}"]`]) {
      expect(readSupabaseSecretKey(envWith(value))).toBeUndefined();
    }
  });

  it('returns nothing when default is missing, empty, or not a string', () => {
    for (const keys of [
      {},
      { other: KEY },
      { default: '' },
      { default: null },
      { default: 42 },
      { default: [KEY] },
    ]) {
      expect(
        readSupabaseSecretKey(envWith(JSON.stringify(keys))),
      ).toBeUndefined();
    }
  });

  it('returns nothing when default is not a secret key', () => {
    for (const value of [
      'sb_publishable_abc123',
      'eyJhbGciOiJIUzI1NiJ9.e30.sig',
      'sb_secret_',
      ' sb_secret_abc123',
    ]) {
      expect(
        readSupabaseSecretKey(envWith(JSON.stringify({ default: value }))),
      ).toBeUndefined();
    }
  });

  it('never logs the variable or the key', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
      (method) => spyOn(console, method).mockImplementation(() => {}),
    );
    try {
      readSupabaseSecretKey(envWith(JSON.stringify({ default: KEY })));
      readSupabaseSecretKey(envWith('{not json'));
      readSupabaseSecretKey(envWith(JSON.stringify({ default: 'sb_x' })));
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
