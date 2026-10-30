import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Issue #88: a database rebuilt from migrations must not grant anon or
 * authenticated more than the deployed project does. These tests read SQL text;
 * `supabase db reset` plus the grant comparison and the profile-write requests in
 * bruno/auth prove the privileges per role.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_local_grants_parity.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_local_grants_parity.sql, found ${files.length}`,
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

describe('local grants parity migration', () => {
  test('limits profiles updates to username, avatar_url and updated_at for authenticated only', () => {
    expect(statements).toContain(
      'revoke update on table public.profiles from anon, authenticated',
    );
    expect(statements).toContain(
      'grant update (avatar_url, updated_at, username) on table public.profiles to authenticated',
    );
  });

  test('removes every privilege from anon and authenticated on server-only tables', () => {
    for (const table of [
      'checkout_recovery_shells',
      'connect_account_actionability',
      'connect_account_events',
      'connect_payout_events',
      'connect_payout_run_shipments',
      'connect_payout_runs',
      'shipment_cancellation_operations',
      'shipment_completion_events',
      'stripe_fee_reconciliation_jobs',
      'webhook_deliveries',
      'admin_connect_payout_release_view',
    ]) {
      expect(sql).toContain(`public.${table}`);
    }
    expect(sql).toMatch(
      /revoke all on table [^;]*public\.webhook_deliveries[^;]* from anon, authenticated/,
    );
  });

  test('keeps notifications and tracking events read-only, with only the production update columns', () => {
    expect(statements).toContain(
      'grant select on table public.notifications to authenticated',
    );
    expect(statements).toContain(
      'grant update (deleted_at, read) on table public.notifications to authenticated',
    );
    expect(statements).toContain(
      'grant select on table public.shipment_tracking_events to authenticated',
    );
  });

  test('never widens: every grant is a narrow authenticated grant', () => {
    const grants = statements.filter((s) => s.startsWith('grant '));
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(grant).toMatch(/ to authenticated$/);
      expect(grant).not.toContain(' all ');
      expect(grant).not.toContain(' anon');
    }
  });
});
