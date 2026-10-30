import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '..');
const name = readdirSync(migrationsDir).find((f) =>
  /^\d{14}_reserve_deleted_username_prefix\.sql$/.test(f),
);
const migration = name
  ? readFileSync(join(migrationsDir, name), 'utf8').replace(/\r\n/g, '\n')
  : '';
const canonical = (file: string) =>
  readFileSync(
    join(migrationsDir, '..', 'queries', 'triggers', 'auth', file),
    'utf8',
  ).replace(/\r\n/g, '\n');

describe('reserve the deleted_ username prefix (SQL structural only)', () => {
  test('the migration exists and is a single transaction', () => {
    expect(name).toBeDefined();
    expect(migration).toMatch(/^BEGIN;$/m);
    expect(migration).toMatch(/^COMMIT;$/m);
  });

  test('a BEFORE INSERT OR UPDATE OF username trigger guards profiles', () => {
    expect(migration).toMatch(
      /CREATE TRIGGER tr_profiles_reserve_deleted_username\s+BEFORE INSERT OR UPDATE OF username ON public\.profiles/,
    );
  });

  test('the prefix match is case-insensitive and rejects with check_violation', () => {
    expect(migration).toMatch(/NEW\.username ILIKE 'deleted\\_%'/);
    expect(migration).toMatch(/ERRCODE = 'check_violation'/);
    expect(migration).toContain('is reserved');
  });

  test('only the closure transition may write the prefix', () => {
    expect(migration).toMatch(
      /TG_OP = 'UPDATE'\s+AND current_user NOT IN \('anon', 'authenticated'\)\s+AND OLD\.deleted_at IS NULL\s+AND NEW\.deleted_at IS NOT NULL/,
    );
  });

  test('an unchanged username is never rejected, so existing rows are left alone', () => {
    expect(migration).toMatch(
      /TG_OP = 'UPDATE' AND NEW\.username IS NOT DISTINCT FROM OLD\.username/,
    );
    expect(migration).not.toMatch(/^\s*(UPDATE|DELETE)\s/m);
  });

  test('the generator never starts a derived username with deleted_', () => {
    expect(migration).toMatch(/v_base LIKE 'deleted\\_%'/);
    expect(canonical('fn_generate_profile_username.sql')).toMatch(
      /v_base LIKE 'deleted\\_%'/,
    );
  });

  test('a bare "deleted" base is prefixed too, so a collision suffix cannot form deleted_NNNN', () => {
    const guard = /IF v_base = 'deleted' OR v_base LIKE 'deleted\\_%' THEN/;
    expect(migration).toMatch(guard);
    expect(canonical('fn_generate_profile_username.sql')).toMatch(guard);
  });

  test('the guard is SECURITY INVOKER with a grant review and no client EXECUTE', () => {
    expect(migration).not.toMatch(/SECURITY DEFINER\s*\n\s*SET/);
    expect(migration).toMatch(/Grant review/);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_reserve_deleted_username\(\)\s+FROM PUBLIC, anon, authenticated/,
    );
    expect(canonical('fn_reserve_deleted_username.sql')).toContain(
      "ERRCODE = 'check_violation'",
    );
  });
});
