import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '..');
const name = readdirSync(migrationsDir).find((f) =>
  /^\d{14}_auth_username_provisioning\.sql$/.test(f),
);
const migration = name
  ? readFileSync(join(migrationsDir, name), 'utf8').replace(/\r\n/g, '\n')
  : '';
const canonical = readFileSync(
  join(
    migrationsDir,
    '..',
    'queries',
    'triggers',
    'auth',
    'fn_on_auth_user_created.sql',
  ),
  'utf8',
).replace(/\r\n/g, '\n');

const canonicalHelper = () =>
  readFileSync(
    join(
      migrationsDir,
      '..',
      'queries',
      'triggers',
      'auth',
      'fn_generate_profile_username.sql',
    ),
    'utf8',
  );

describe('auth username provisioning migration (SQL structural only)', () => {
  test('the migration exists and is a single transaction', () => {
    expect(name).toBeDefined();
    expect(migration).toMatch(/^BEGIN;$/m);
    expect(migration).toMatch(/^COMMIT;$/m);
  });

  test('the trigger function stays SECURITY DEFINER with an explicit search_path', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.fn_on_auth_user_created\(\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = public, pg_temp/,
    );
  });

  test('a typed username is validated and rejected, not coerced', () => {
    expect(migration).toMatch(/char_length\(v_typed\) NOT BETWEEN 3 AND 20/);
    expect(migration).toMatch(/ERRCODE = 'check_violation'/);
    expect(migration).toMatch(/ERRCODE = 'unique_violation'/);
  });

  test('a derived username comes from full_name, name, then the email prefix', () => {
    expect(migration).toMatch(
      /raw_user_meta_data->>'full_name'[\s\S]*?raw_user_meta_data->>'name'[\s\S]*?split_part\(NEW\.email, '@', 1\)/,
    );
  });

  test('derivation uses the profile editor charset and clamps to 20', () => {
    expect(migration).toContain('[^a-z0-9_.]');
    expect(migration).toMatch(/left\(/i);
    expect(migration).toMatch(/20/);
  });

  test('a taken derived username gets a random numeric suffix until free', () => {
    expect(migration).toMatch(/random\(\)/);
    expect(migration).toMatch(/'_' \|\|/);
    expect(migration).toMatch(/LOOP/);
  });

  test('the suffix search is bounded so the auth insert can never loop forever', () => {
    expect(migration).toMatch(/IF v_attempt > 50 THEN\s+RAISE EXCEPTION/);
    expect(canonicalHelper()).toMatch(/IF v_attempt > 50 THEN\s+RAISE EXCEPTION/);
  });

  test('profiles_private provisioning is unchanged and idempotent', () => {
    expect(migration).toMatch(
      /INSERT INTO public\.profiles_private \(id, email, role, status\)\s+VALUES \(NEW\.id, NEW\.email, 'user', 'active'\)\s+ON CONFLICT \(id\) DO NOTHING/,
    );
    expect(migration).toMatch(
      /INSERT INTO public\.profiles \([\s\S]*?ON CONFLICT \(id\) DO NOTHING/,
    );
  });

  test('the helper and trigger function are not executable by PUBLIC, anon or authenticated', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_generate_profile_username\(text\)\s+FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_on_auth_user_created\(\)\s+FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(/Grant review/);
  });

  test('backfills auth users missing profiles or profiles_private without wallets', () => {
    const backfill = migration.slice(migration.indexOf('Backfill'));
    expect(backfill).toMatch(/FROM auth\.users/);
    expect(backfill).toMatch(/LEFT JOIN public\.profiles /);
    expect(backfill).toMatch(/LEFT JOIN public\.profiles_private /);
    expect(backfill).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    expect(backfill).not.toMatch(/wallets/);
  });

  test('the canonical trigger source matches the migration body', () => {
    expect(canonical).toContain('char_length(v_typed) NOT BETWEEN 3 AND 20');
    expect(canonical).toContain('fn_generate_profile_username');
    expect(canonical).toContain("ERRCODE = 'unique_violation'");
  });
});
