import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDirectory = join(import.meta.dir, '..');
const queriesDirectory = join(import.meta.dir, '..', '..', 'queries', 'tracking');

const findLeaseMigration = (): string => {
  const matches = readdirSync(migrationsDirectory).filter(
    (file) => file.endsWith('_add_tracking_poll_leases.sql'),
  );
  expect(matches).toHaveLength(1);
  return join(migrationsDirectory, matches[0]);
};

const sql = (): string => readFileSync(findLeaseMigration(), 'utf8');

describe('tracking polling TTL lease migration', () => {
  it('adds independent nullable lease identity and expiry fields to system_settings', () => {
    const migration = sql();

    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS track_shipments_preparing_lease_id UUID',
    );
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS track_shipments_preparing_lease_expires_at TIMESTAMPTZ',
    );
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS track_shipments_shipped_lease_id UUID',
    );
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS track_shipments_shipped_lease_expires_at TIMESTAMPTZ',
    );
  });

  it('atomically replaces only a missing or expired lane lease for a fixed 300-second TTL', () => {
    const migration = sql();
    const acquire = migration.match(
      /CREATE OR REPLACE FUNCTION public\.fn_acquire_track_shipments_lease[\s\S]*?\$\$;/,
    )?.[0];
    const normalizedAcquire = acquire?.replace(/\s+/g, ' ');

    expect(normalizedAcquire).toContain("p_lane NOT IN ('preparing', 'shipped')");
    expect(normalizedAcquire).toContain('gen_random_uuid()');
    expect(normalizedAcquire).toContain("interval '300 seconds'");
    expect(normalizedAcquire).toContain('WHERE id = 1');
    expect(normalizedAcquire).toContain('IS NULL OR');
    expect(normalizedAcquire).toContain('<= pg_catalog.statement_timestamp()');
    expect(normalizedAcquire).toContain('RETURN QUERY SELECT false, NULL::UUID, NULL::TIMESTAMPTZ');
  });

  it('releases only the matching current owner and keeps both RPCs service-role-only', () => {
    const migration = sql();
    const release = migration.match(
      /CREATE OR REPLACE FUNCTION public\.fn_release_track_shipments_lease[\s\S]*?\$\$;/,
    )?.[0];
    const normalizedRelease = release?.replace(/\s+/g, ' ');

    expect(normalizedRelease).toContain('WHERE id = 1');
    expect(normalizedRelease).toContain('p_lease_id');
    expect(normalizedRelease).toContain('RETURNING true INTO v_released');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.fn_acquire_track_shipments_lease');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.fn_release_track_shipments_lease');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.fn_acquire_track_shipments_lease');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.fn_release_track_shipments_lease');
    expect(migration).toContain('TO service_role');
  });

  it('keeps canonical acquire and release SQL sources alongside the deployable migration', () => {
    const migration = sql().replace(/\r\n/g, '\n');
    const acquirePath = join(queriesDirectory, 'fn_acquire_track_shipments_lease.sql');
    const releasePath = join(queriesDirectory, 'fn_release_track_shipments_lease.sql');

    expect(existsSync(acquirePath)).toBeTrue();
    expect(existsSync(releasePath)).toBeTrue();
    expect(migration).toContain(readFileSync(acquirePath, 'utf8').replace(/\r\n/g, '\n'));
    expect(migration).toContain(readFileSync(releasePath, 'utf8').replace(/\r\n/g, '\n'));
  });
});
