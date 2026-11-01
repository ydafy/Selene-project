import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Issue #122 (auth part): anon and authenticated keep only the privileges the
 * clients use on the auth tables and admin views. These tests read SQL text; the
 * pgTAP file supabase/tests/database/auth_grants.test.sql proves the privileges
 * per role against PostgreSQL.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_auth_grants_least_privilege.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_auth_grants_least_privilege.sql, found ${files.length}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8').replace(
    /\r/g,
    '',
  );
};

const sql = findMigration()
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const statements = sql
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

describe('auth grants least privilege migration', () => {
  test('revokes every privilege from anon and authenticated before granting', () => {
    const revoke = statements.find((s) => s.startsWith('revoke all on table'));
    expect(revoke).toBeDefined();
    expect(revoke).toEndWith(' from anon, authenticated');
    for (const relation of [
      'profiles',
      'profiles_private',
      'admin_audit_logs',
      'admin_user_notes',
      'admin_user_directory_view',
      'admin_disputes_monitor_view',
      'admin_product_queue_view',
      'admin_connect_earnings_view',
      'admin_seller_onboarding_view',
    ]) {
      expect(revoke).toMatch(new RegExp(`public\.${relation}(,| from)`));
    }
  });

  test('re-grants the profiles update columns the table-level revoke removed', () => {
    expect(statements).toContain(
      'grant update (avatar_url, updated_at, username) on table public.profiles to authenticated',
    );
  });

  test('grants anon nothing but SELECT on profiles', () => {
    const anonGrants = statements.filter(
      (s) => s.startsWith('grant ') && /\banon\b/.test(s),
    );
    expect(anonGrants).toEqual([
      'grant select on table public.profiles to anon, authenticated',
    ]);
  });

  test('grants admin notes SELECT and INSERT only, never writes on profiles_private', () => {
    expect(statements).toContain(
      'grant select, insert on table public.admin_user_notes to authenticated',
    );
    const grants = statements.filter((s) => s.startsWith('grant '));
    for (const grant of grants) {
      expect(grant).not.toContain(' all ');
      expect(grant).not.toContain('delete');
      expect(grant).not.toContain('truncate');
    }
    const privateGrant = statements.find((s) =>
      s.startsWith('grant select on table public.profiles_private'),
    );
    expect(privateGrant).toBeDefined();
  });
});
