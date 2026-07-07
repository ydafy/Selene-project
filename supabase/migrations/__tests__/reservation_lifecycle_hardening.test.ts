import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static validation for reservation-lifecycle-hardening (PR 1 / Work Unit 1).
 *
 * These tests do NOT exercise a live Postgres database (Supabase changes are
 * applied manually by the user per workflow/supabase-manual-apply). They guard
 * the SQL source artifacts statically so the migration and query files stay
 * deployable, self-contained, and consistent with the spec/design.
 *
 * Covered acceptance criteria (from spec/design):
 *   - Reservation TTL: 10 minutes via `reserved_at < now() - interval '10 minutes'`
 *   - Stale reservation cleanup: atomic batch release, optionally scoped by IDs
 *   - Reserve releases expired requested rows first, then reserves only VERIFIED
 *   - Release is strict RESERVED -> VERIFIED, clears reserved_at, idempotent
 *   - Partial index on products(status, reserved_at) WHERE status='RESERVED'
 *   - No AVAILABLE status, no checkout_sessions table (out-of-scope hard guards)
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(
  import.meta.dir,
  '..',
  '..',
  'queries',
  'products',
);

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.endsWith('.sql') && f.includes('reservation_lifecycle_hardening'),
  );
  if (files.length === 0) {
    throw new Error(
      'Migration file matching *reservation_lifecycle_hardening*.sql not found',
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
};

const readQuery = (name: string): string =>
  readFileSync(join(QUERIES_DIR, name), 'utf8');

describe('reservation lifecycle hardening migration', () => {
  test('migration file exists in supabase/migrations', () => {
    expect(() => findMigration()).not.toThrow();
  });

  test('registers fn_release_stale_reservations as a deployable RPC', () => {
    const sql = findMigration();
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_release_stale_reservations/i,
    );
    expect(sql).toMatch(/p_product_ids\s+UUID\[\]\s+DEFAULT\s+'\{\}'/i);
    expect(sql).toMatch(/RETURNS\s+TABLE\s*\(\s*released_id\s+UUID\s*\)/i);
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_release_stale_reservations\s*\(\s*UUID\[\]\s*\)\s+TO\s+service_role/i,
    );
  });

  test('cleanup query targets only RESERVED rows past the 10-minute TTL', () => {
    const sql = findMigration();
    expect(sql).toMatch(/status\s*=\s*'RESERVED'/i);
    expect(sql).toMatch(
      /reserved_at\s*<\s*now\(\)\s*-\s*interval\s+'10\s+minutes'/i,
    );
    // Optional product-ID scoping with safe empty-array default
    expect(sql).toMatch(
      /\(p_product_ids\s*=\s*'\{\}'\s+OR\s+id\s*=\s*ANY\(p_product_ids\)\)/i,
    );
  });

  test('adds partial index on products(status, reserved_at) WHERE RESERVED', () => {
    const sql = findMigration();
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_products_reserved_status_reserved_at/i,
    );
    expect(sql).toMatch(/ON\s+public\.products\s*\(\s*status\s*,\s*reserved_at\s*\)/i);
    expect(sql).toMatch(/WHERE\s+status\s*=\s*'RESERVED'/i);
  });

  test('fn_reserve_products releases expired requested rows first', () => {
    const sql = findMigration();
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_reserve_products/i,
    );
    // Pre-release step scoped to the requested product IDs
    expect(sql).toMatch(
      /UPDATE\s+public\.products[\s\S]*?SET\s+status\s*=\s*'VERIFIED'[\s\S]*?reserved_at\s*=\s*NULL[\s\S]*?WHERE\s+id\s*=\s*ANY\(p_product_ids\)[\s\S]*?AND\s+status\s*=\s*'RESERVED'[\s\S]*?AND\s+reserved_at\s*<\s*now\(\)\s*-\s*interval\s+'10\s+minutes'/i,
    );
  });

  test('fn_reserve_products reserves only VERIFIED stock not owned by buyer', () => {
    const sql = findMigration();
    expect(sql).toMatch(
      /SET\s+status\s*=\s*'RESERVED'[\s\S]*?reserved_at\s*=\s*now\(\)[\s\S]*?AND\s+status\s*=\s*'VERIFIED'[\s\S]*?seller_id\s*<>\s*p_buyer_id/i,
    );
    expect(sql).toMatch(/SOME_PRODUCTS_UNAVAILABLE/);
  });

  test('fn_release_products uses strict RESERVED -> VERIFIED guard and is idempotent', () => {
    const sql = findMigration();
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_release_products/i,
    );
    expect(sql).toMatch(
      /UPDATE\s+public\.products[\s\S]*?SET\s+status\s*=\s*'VERIFIED'[\s\S]*?reserved_at\s*=\s*NULL[\s\S]*?WHERE\s+id\s*=\s*ANY\(p_product_ids\)[\s\S]*?AND\s+status\s*=\s*'RESERVED'/i,
    );
    expect(sql).toMatch(/RETURN\s+QUERY\s+SELECT\s+true/i);
  });

  test('grants execute on all three RPCs to service_role only', () => {
    const sql = findMigration();
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_reserve_products\s*\(\s*UUID\s*,\s*UUID\[\]\s*\)\s+TO\s+service_role/i,
    );
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_release_products\s*\(\s*UUID\[\]\s*\)\s+TO\s+service_role/i,
    );
    // Must not GRANT privileged release/reserve to anon or authenticated.
    // (REVOKE uses FROM, so this stays satisfied even after explicit revokes.)
    expect(sql).not.toMatch(/GRANT[\s\S]*?TO\s+anon/i);
    expect(sql).not.toMatch(/GRANT[\s\S]*?TO\s+authenticated/i);
  });

  test('explicitly REVOKE EXECUTE from PUBLIC, anon, and authenticated for every RPC', () => {
    // Postgres grants EXECUTE on every new function to PUBLIC by default, and
    // anon/authenticated inherit from PUBLIC. A service_role-only GRANT is NOT
    // sufficient — privileged release/reserve RPCs would stay callable by any
    // anon/authenticated caller. Explicit REVOKE is required.
    const sql = findMigration();
    const rpcSignatures = [
      'public\\.fn_release_stale_reservations\\s*\\(\\s*UUID\\[\\]\\s*\\)',
      'public\\.fn_reserve_products\\s*\\(\\s*UUID\\s*,\\s*UUID\\[\\]\\s*\\)',
      'public\\.fn_release_products\\s*\\(\\s*UUID\\[\\]\\s*\\)',
    ];
    for (const sig of rpcSignatures) {
      const re = new RegExp(
        `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${sig}\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated`,
        'i',
      );
      expect(sql).toMatch(re);
    }
  });

  test('fn_reserve_products is all-or-nothing: no partial reservation on count mismatch', () => {
    // When not every requested product can be reserved, the function must NOT
    // leave a subset of products in RESERVED. It must release the tentative
    // reservations made by this call so product statuses are unchanged except
    // the legitimate stale-row pre-release.
    const sql = findMigration();
    // The reserve UPDATE captures reserved ids (so the rollback can target only
    // the rows this call reserved, not unrelated RESERVED stock).
    expect(sql).toMatch(/RETURNING\s+id\s*,\s*price/i);
    // A rollback UPDATE releases the just-reserved rows on failure: scoped to a
    // captured id array (NOT the requested array, and NOT TTL-conditioned so it
    // is distinct from the legitimate stale pre-release).
    expect(sql).toMatch(
      /UPDATE\s+public\.products[\s\S]*?SET\s+status\s*=\s*'VERIFIED'[\s\S]*?reserved_at\s*=\s*NULL[\s\S]*?WHERE\s+id\s*=\s*ANY\(\s*v_reserved_ids\s*\)\s*AND\s+status\s*=\s*'RESERVED'/i,
    );
    // The rollback must live inside the failure branch, after a count-mismatch
    // check against the full requested array.
    expect(sql).toMatch(
      /v_count\s*=\s*array_length\(\s*p_product_ids\s*,\s*1\s*\)/i,
    );
  });

  test('does not introduce AVAILABLE status or checkout_sessions table', () => {
    const sql = findMigration();
    // Guard against the forbidden status literal being written, not the word
    // appearing in descriptive comments about what is NOT introduced.
    expect(sql).not.toMatch(/SET\s+status\s*=\s*'AVAILABLE'/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE[\s\S]*?checkout_sessions/i);
  });
});

describe('reservation lifecycle hardening query source files', () => {
  test('fn_release_stale_reservations.sql is deployable and self-contained', () => {
    const sql = readQuery('fn_release_stale_reservations.sql');
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_release_stale_reservations/i,
    );
    expect(sql).toMatch(/p_product_ids\s+UUID\[\]\s+DEFAULT\s+'\{\}'/i);
    expect(sql).toMatch(
      /reserved_at\s*<\s*now\(\)\s*-\s*interval\s+'10\s+minutes'/i,
    );
  });

  test('fn_reserve_products.sql includes expired pre-release and VERIFIED-only reserve', () => {
    const sql = readQuery('fn_reserve_products.sql');
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_reserve_products/i,
    );
    expect(sql).toMatch(
      /UPDATE\s+public\.products[\s\S]*?reserved_at\s*=\s*NULL[\s\S]*?AND\s+status\s*=\s*'RESERVED'[\s\S]*?reserved_at\s*<\s*now\(\)\s*-\s*interval\s+'10\s+minutes'/i,
    );
    expect(sql).toMatch(/AND\s+status\s*=\s*'VERIFIED'[\s\S]*?seller_id\s*<>\s*p_buyer_id/i);
    expect(sql).toMatch(/SOME_PRODUCTS_UNAVAILABLE/);
  });

  test('fn_release_products.sql guards RESERVED -> VERIFIED and clears reserved_at', () => {
    const sql = readQuery('fn_release_products.sql');
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_release_products/i,
    );
    expect(sql).toMatch(/reserved_at\s*=\s*NULL/i);
    expect(sql).toMatch(/WHERE\s+id\s*=\s*ANY\(p_product_ids\)/i);
    expect(sql).toMatch(/AND\s+status\s*=\s*'RESERVED'/i);
    expect(sql).toMatch(/RETURN\s+QUERY\s+SELECT\s+true/i);
  });
});

describe('reservation lifecycle hardening RPC permission hardening', () => {
  const rpcFiles = [
    {
      name: 'fn_release_stale_reservations.sql',
      signature: 'public\\.fn_release_stale_reservations\\s*\\(\\s*UUID\\[\\]\\s*\\)',
    },
    {
      name: 'fn_reserve_products.sql',
      signature:
        'public\\.fn_reserve_products\\s*\\(\\s*UUID\\s*,\\s*UUID\\[\\]\\s*\\)',
    },
    {
      name: 'fn_release_products.sql',
      signature: 'public\\.fn_release_products\\s*\\(\\s*UUID\\[\\]\\s*\\)',
    },
  ];

  for (const rpc of rpcFiles) {
    test(`${rpc.name} explicitly revokes EXECUTE from PUBLIC, anon, authenticated before granting to service_role`, () => {
      const sql = readQuery(rpc.name);
      const revokeRe = new RegExp(
        `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${rpc.signature}\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated`,
        'i',
      );
      const grantRe = new RegExp(
        `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${rpc.signature}\\s+TO\\s+service_role`,
        'i',
      );
      expect(sql).toMatch(revokeRe);
      expect(sql).toMatch(grantRe);
      // REVOKE must appear before GRANT so default PUBLIC execute is removed
      // before the service_role grant is issued.
      const revokeIdx = sql.search(revokeRe);
      const grantIdx = sql.search(grantRe);
      expect(revokeIdx).toBeGreaterThan(-1);
      expect(grantIdx).toBeGreaterThan(revokeIdx);
    });
  }
});

describe('reservation lifecycle hardening query source — all-or-nothing reserve', () => {
  test('fn_reserve_products.sql rolls back partial reservations on count mismatch', () => {
    const sql = readQuery('fn_reserve_products.sql');
    // Reserve UPDATE captures reserved ids so the rollback only touches rows
    // this call reserved, not unrelated RESERVED stock.
    expect(sql).toMatch(/RETURNING\s+id\s*,\s*price/i);
    // Rollback UPDATE on the failure path: scoped to the captured id array,
    // strict RESERVED guard, no TTL condition (distinct from stale pre-release).
    expect(sql).toMatch(
      /UPDATE\s+public\.products[\s\S]*?SET\s+status\s*=\s*'VERIFIED'[\s\S]*?reserved_at\s*=\s*NULL[\s\S]*?WHERE\s+id\s*=\s*ANY\(\s*v_reserved_ids\s*\)\s*AND\s+status\s*=\s*'RESERVED'/i,
    );
    // Count-mismatch check against the full requested array gates the rollback.
    expect(sql).toMatch(/v_count\s*=\s*array_length\(\s*p_product_ids\s*,\s*1\s*\)/i);
  });
});