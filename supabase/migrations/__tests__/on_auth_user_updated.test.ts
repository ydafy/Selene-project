import { expect, test, describe } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Asserts the on_auth_user_updated migration exists and is idempotent.
 * Covers CONF-019 + EXTD-TASK-001 acceptance criteria.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const TRIGGERS_DIR = join(
  import.meta.dir,
  '..',
  '..',
  'queries',
  'triggers',
  'auth',
);

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.endsWith('.sql') && f.includes('on_auth_user_updated'),
  );
  if (files.length === 0) {
    throw new Error(
      'Migration file matching *on_auth_user_updated*.sql not found',
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
};

describe('on_auth_user_updated migration', () => {
  test('migration file exists in supabase/migrations', () => {
    expect(() => findMigration()).not.toThrow();
  });

  test('drops trigger if exists for idempotence', () => {
    const sql = findMigration();
    expect(sql).toMatch(
      /DROP\s+TRIGGER\s+IF\s+EXISTS\s+on_auth_user_updated\s+ON\s+auth\.users/i,
    );
  });

  test('uses CREATE OR REPLACE FUNCTION (idempotent)', () => {
    const sql = findMigration();
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_on_auth_user_updated/i,
    );
  });

  test('updates profiles_private.email with NEW.email', () => {
    const sql = findMigration();
    expect(sql).toMatch(/UPDATE\s+public\.profiles_private/i);
    expect(sql).toMatch(/email\s*=\s*NEW\.email/i);
  });

  test('does NOT reference removed profiles.email column', () => {
    const sql = findMigration();
    // The removed-columns migration dropped profiles.email
    expect(sql).not.toMatch(/UPDATE\s+public\.profiles\s+SET\s+email/i);
  });

  test('reattaches AFTER UPDATE trigger on auth.users', () => {
    const sql = findMigration();
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+on_auth_user_updated/i);
    expect(sql).toMatch(/AFTER\s+UPDATE\s+ON\s+auth\.users/i);
  });

  test('uses SECURITY DEFINER + search_path = empty', () => {
    const sql = findMigration();
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/search_path\s*=\s*['"]{2}/i);
  });
});

describe('fn_on_auth_user_updated source file', () => {
  test('queries/triggers SQL targets profiles_private (not profiles)', () => {
    const body = readFileSync(
      join(TRIGGERS_DIR, 'fn_on_auth_user_updated.sql'),
      'utf8',
    );
    expect(body).toMatch(/UPDATE\s+public\.profiles_private/i);
    expect(body).not.toMatch(/UPDATE\s+public\.profiles\s+SET\s+email/i);
  });
});
