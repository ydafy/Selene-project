import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for the push token registry (expo-push-notifications T1/S1/S3).
 * These tests read SQL text; `supabase db reset` and the Bruno requests in
 * bruno/push prove the SQL runs and what each role can do.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries');

const findMigration = (name: string): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => new RegExp(String.raw`^\d+_${name}\.sql$`).test(f));
  if (files.length !== 1) {
    throw new Error(`Expected exactly one *_${name}.sql, found ${files.length}`);
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
};

const normalize = (sql: string): string =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const definition = (sql: string, name: string): string | undefined =>
  normalize(sql).match(
    new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.${name}\(.*?\$\$ ?;`, 'i'),
  )?.[0];

const rawDefinition = (sql: string, name: string): string | undefined =>
  sql
    .replace(/\r/g, '')
    .match(new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.${name}\(.*?\n\$\$;`, 's'))?.[0];

const migration = findMigration('push_tokens');
const code = normalize(migration);

describe('push_tokens table', () => {
  test('has the registry columns', () => {
    expect(code).toContain('CREATE TABLE public.push_tokens');
    expect(code).toContain('id uuid PRIMARY KEY DEFAULT gen_random_uuid()');
    expect(code).toContain('user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(code).toContain('token text NOT NULL UNIQUE');
    expect(code).toContain('platform text NOT NULL');
    expect(code).toContain('created_at timestamptz NOT NULL DEFAULT now()');
    expect(code).toContain('updated_at timestamptz NOT NULL DEFAULT now()');
    expect(code).toContain('disabled_at timestamptz');
    expect(code).toContain('disabled_reason text');
  });

  test('restricts platform and token shape', () => {
    expect(code).toContain("CHECK (platform IN ('ios', 'android'))");
    expect(code).toContain('char_length(token) <= 255');
    expect(code).toContain(String.raw`token ~ '^Expo(nent)?PushToken\[[^\]\s]+\]$'`);
  });

  test('indexes active tokens per user', () => {
    expect(code).toContain(
      'CREATE INDEX push_tokens_active_user_idx ON public.push_tokens (user_id) WHERE disabled_at IS NULL;',
    );
  });

  test('enables RLS and closes the table to every client role', () => {
    expect(code).toContain('ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;');
    expect(code).toContain('REVOKE ALL ON TABLE public.push_tokens FROM PUBLIC, anon, authenticated;');
    expect(code).toContain('GRANT ALL ON TABLE public.push_tokens TO service_role;');
    expect(code).not.toMatch(/CREATE POLICY/i);
  });
});

describe('push token RPCs', () => {
  for (const [name, args] of [
    ['fn_register_push_token', 'text,text'],
    ['fn_unregister_push_token', 'text'],
  ] as const) {
    test(`${name} is a definer with a pinned search_path and authenticated-only EXECUTE`, () => {
      const def = definition(migration, name);
      expect(def).toBeDefined();
      expect(def).toContain('RETURNS void');
      expect(def).toContain('SECURITY DEFINER');
      expect(def).toContain('SET search_path = public, pg_temp');
      expect(def).toContain('auth.uid()');
      expect(code).toContain(
        `REVOKE EXECUTE ON FUNCTION public.${name}(${args.replace(/,/g, ', ')}) FROM PUBLIC, anon;`,
      );
      expect(code).toContain(
        `GRANT EXECUTE ON FUNCTION public.${name}(${args.replace(/,/g, ', ')}) TO authenticated;`,
      );
      expect(code).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}[^;]*(anon|PUBLIC)`));
    });
  }

  test('register upserts on the token, moves it to the caller and clears the disabled state', () => {
    const def = definition(migration, 'fn_register_push_token')!;
    expect(def).toContain('ON CONFLICT (token) DO UPDATE SET');
    expect(def).toContain('user_id = EXCLUDED.user_id');
    expect(def).toContain('updated_at = now()');
    expect(def).toContain('disabled_at = NULL');
    expect(def).toContain('disabled_reason = NULL');
  });

  test('register rejects a missing session, a bad token and a bad platform', () => {
    const def = definition(migration, 'fn_register_push_token')!;
    expect(def).toContain('UNAUTHORIZED');
    expect(def).toContain('INVALID_PUSH_TOKEN');
    expect(def).toContain('INVALID_PUSH_PLATFORM');
  });

  test('unregister deletes only the caller own row and never raises for a missing one', () => {
    const def = definition(migration, 'fn_unregister_push_token')!;
    expect(def).toContain('DELETE FROM public.push_tokens WHERE token = p_token AND user_id = v_user_id;');
    expect(def).not.toContain('NOT FOUND');
  });

  test('grant review is explained in the header', () => {
    expect(migration).toContain('Grant review');
  });
});

describe('account closure removes push tokens', () => {
  const closure = findMigration('close_account_push_tokens');
  const canonical = readFileSync(join(QUERIES_DIR, 'auth', 'fn_close_account.sql'), 'utf8');
  const deleteTokens = 'DELETE FROM public.push_tokens WHERE user_id = p_user_id;';

  test('the migration and the canonical function delete the user tokens', () => {
    expect(definition(closure, 'fn_close_account')).toContain(deleteTokens);
    expect(definition(canonical, 'fn_close_account')).toContain(deleteTokens);
  });

  test('the migration body equals the canonical function', () => {
    expect(rawDefinition(closure, 'fn_close_account')).toBeDefined();
    expect(rawDefinition(closure, 'fn_close_account')).toBe(rawDefinition(canonical, 'fn_close_account'));
  });

  test('the closure stays service-role only', () => {
    expect(normalize(closure)).toContain(
      'REVOKE EXECUTE ON FUNCTION public.fn_close_account(uuid) FROM PUBLIC, anon, authenticated;',
    );
    expect(normalize(closure)).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_close_account(uuid) TO service_role;',
    );
  });
});

describe('canonical SQL parity', () => {
  for (const name of ['fn_register_push_token', 'fn_unregister_push_token']) {
    test(`${name} canonical file matches the migration`, () => {
      const canonical = readFileSync(join(QUERIES_DIR, 'push', `${name}.sql`), 'utf8');
      expect(rawDefinition(canonical, name)).toBeDefined();
      expect(rawDefinition(canonical, name)).toBe(rawDefinition(migration, name));
    });
  }
});
