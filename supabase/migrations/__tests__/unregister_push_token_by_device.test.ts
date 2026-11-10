import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for removing a push token by the device that holds it
 * (expo-push-notifications T9b, S1). These tests read SQL text; `supabase db
 * reset` and the Bruno requests in bruno/push prove what each role can do.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');

const findMigration = (name: string): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    new RegExp(String.raw`^\d+_${name}\.sql$`).test(f),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_${name}.sql, found ${files.length}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
};

const normalize = (sql: string): string =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const NAME = 'fn_unregister_push_token';

const definition = (sql: string): string | undefined =>
  normalize(sql).match(
    new RegExp(
      String.raw`CREATE OR REPLACE FUNCTION public\.${NAME}\(.*?\$\$ ?;`,
      'i',
    ),
  )?.[0];

const migration = findMigration('unregister_push_token_by_device');
const code = normalize(migration);
const def = definition(migration)!;

describe('fn_unregister_push_token by device', () => {
  test('keeps the signature, the definer and the pinned search_path', () => {
    expect(def).toBeDefined();
    expect(def).toContain('fn_unregister_push_token(p_token text)');
    expect(def).toContain('RETURNS void');
    expect(def).toContain('SECURITY DEFINER');
    expect(def).toContain('SET search_path = public, pg_temp');
  });

  test('deletes the exact token whoever calls it', () => {
    expect(def).toContain(
      'DELETE FROM public.push_tokens WHERE token = p_token;',
    );
    expect(def).not.toContain('auth.uid()');
    expect(def).not.toContain('user_id');
    expect(def).not.toContain('UNAUTHORIZED');
  });

  test('rejects a malformed token with the same check as register', () => {
    expect(def).toContain('p_token IS NULL');
    expect(def).toContain('char_length(p_token) > 255');
    expect(def).toContain(
      String.raw`p_token !~ '^Expo(nent)?PushToken\[[^\]\s]+\]$'`,
    );
    expect(def).toContain("RAISE EXCEPTION 'INVALID_PUSH_TOKEN'");
  });

  test('a missing token is a no-op', () => {
    expect(def).not.toContain('NOT FOUND');
  });

  test('EXECUTE is revoked from PUBLIC and granted to anon and authenticated', () => {
    expect(code).toContain(
      `REVOKE EXECUTE ON FUNCTION public.${NAME}(text) FROM PUBLIC;`,
    );
    expect(code).toContain(
      `GRANT EXECUTE ON FUNCTION public.${NAME}(text) TO anon, authenticated;`,
    );
    expect(code).not.toMatch(
      new RegExp(`GRANT EXECUTE ON FUNCTION public\.${NAME}[^;]*PUBLIC`),
    );
  });

  test('the function comment describes the new behavior', () => {
    expect(code).toContain(`COMMENT ON FUNCTION public.${NAME}(text) IS`);
    expect(code).not.toContain('authenticated only');
  });

  test('grant review is explained in the header', () => {
    expect(migration).toContain('Grant review');
    expect(migration).toContain('anon');
  });
});
