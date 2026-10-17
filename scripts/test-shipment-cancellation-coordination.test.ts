import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = 'scripts/test-shipment-cancellation-coordination.ts';

test('label coordination replaces only latest signatures and mirrors body-only canonical files', () => {
  const migrations = readdirSync(`${root}supabase/migrations`).filter((name) =>
    name.endsWith('_shipment_cancellation_label_coordination.sql'),
  );
  expect(migrations).toHaveLength(1);
  const sql = readFileSync(
    `${root}supabase/migrations/${migrations[0]}`,
    'utf8',
  );
  expect(sql.match(/CREATE OR REPLACE FUNCTION public\.[a-z_]+/g)).toEqual([
    'CREATE OR REPLACE FUNCTION public.fn_claim_shipment_label',
    'CREATE OR REPLACE FUNCTION public.fn_mark_shipment_label_sent',
  ]);
  for (const name of [
    'fn_claim_shipment_label',
    'fn_mark_shipment_label_sent',
  ]) {
    const body = sql.match(
      new RegExp(
        `FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
      ),
    )?.[1];
    expect(body?.replaceAll('\r\n', '\n').trim()).toBe(
      readFileSync(`${root}supabase/queries/shipments/${name}.sql`, 'utf8')
        .replaceAll('\r\n', '\n')
        .trim(),
    );
  }
  expect(sql).toContain(
    'p_shipment_id UUID, p_seller_id UUID, p_origin_address_id UUID',
  );
  expect(sql).not.toMatch(
    /(?:UPDATE|DELETE FROM|INSERT INTO)\s+public\.shipment_cancellation_operations/i,
  );
});

// These tests never connect to a database. Execute the standalone harness for
// PostgreSQL behavior; a plain `bun test` must remain safe without Docker.
test('B1.1/B1.2/B1.3 help describes the local-only scope without starting a database', () => {
  const result = Bun.spawnSync(['bun', script, '--help'], { cwd: root });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe(
    `Usage: bun ${script} [--help]\n` +
      'B1.1/B1.2/B1.3 SQL: cancellation/label arbitration, frozen refund request, ownership and contention in a new disposable local database.\n' +
      'Uses only 127.0.0.1, selene_test credentials and SELENE_TEST_PG_PORT (default 55432).\n',
  );
  expect(result.stderr.toString()).toBe('');
});

test('unknown arguments reject before database work', () => {
  const result = Bun.spawnSync(['bun', script, '--remote'], { cwd: root });
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toBe('');
  expect(result.stderr.toString()).toBe(
    'FAIL: Unknown arguments. Use --help.\n',
  );
});

test.each(['0', '65536', 'abc'])(
  'invalid port %s rejects before database work',
  (port) => {
    const result = Bun.spawnSync(['bun', script], {
      cwd: root,
      env: { ...process.env, SELENE_TEST_PG_PORT: port },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe('');
    expect(result.stderr.toString()).toBe(
      'FAIL: SELENE_TEST_PG_PORT must be an integer between 1 and 65535.\n',
    );
  },
);

test('canonical refund-request SQL matches exactly one additive migration', () => {
  const migrations = readdirSync(`${root}supabase/migrations`).filter((name) =>
    name.endsWith('_shipment_cancellation_refund_request.sql'),
  );
  expect(migrations).toHaveLength(1);
  const sql = readFileSync(
    `${root}supabase/migrations/${migrations[0]}`,
    'utf8',
  );
  expect(sql).toBe(
    readFileSync(
      `${root}supabase/queries/orders/shipment_cancellation_refund_request.sql`,
      'utf8',
    ),
  );
  expect(sql.match(/CREATE OR REPLACE FUNCTION public\.[a-z_]+/g)).toEqual([
    'CREATE OR REPLACE FUNCTION public.fn_start_shipment_cancellation_refund',
  ]);
  expect(sql).not.toMatch(
    /UPDATE\s+public\.(?:shipments|orders|products|notifications)\b/i,
  );
});

test('canonical coordination SQL matches exactly one additive migration', () => {
  const migrations = readdirSync(`${root}supabase/migrations`).filter((name) =>
    name.endsWith('_shipment_cancellation_coordination.sql'),
  );
  expect(migrations).toHaveLength(1);
  const sql = readFileSync(
    `${root}supabase/migrations/${migrations[0]}`,
    'utf8',
  );
  expect(sql).toBe(
    readFileSync(
      `${root}supabase/queries/orders/shipment_cancellation_coordination.sql`,
      'utf8',
    ),
  );
  // Dormant foundation: do not replace any existing deployed RPC or handler.
  expect(sql.match(/CREATE OR REPLACE FUNCTION public\.[a-z_]+/g)).toEqual([
    'CREATE OR REPLACE FUNCTION public.fn_claim_shipment_cancellation',
    'CREATE OR REPLACE FUNCTION public.fn_start_shipment_cancellation',
  ]);
  expect(sql).not.toMatch(
    /UPDATE\s+public\.(?:shipments|orders|products|notifications)\b/i,
  );
});
