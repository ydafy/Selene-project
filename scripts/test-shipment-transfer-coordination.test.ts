import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = 'scripts/test-shipment-transfer-coordination.ts';

test('transfer harness help is exact and local-only without a database', () => {
  const result = Bun.spawnSync(['bun', script, '--help'], { cwd: root });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe(
    `Usage: bun ${script} [--help]\n` +
      'B1.3 transfer SQL: public RPC arbitration, ownership, uncertainty and preservation in a disposable local database.\n' +
      'Uses only 127.0.0.1, selene_test credentials and SELENE_TEST_PG_PORT (default 55432).\n',
  );
  expect(result.stderr.toString()).toBe('');
});

test('transfer harness refuses unknown arguments before database effects', () => {
  const result = Bun.spawnSync(['bun', script, '--remote'], { cwd: root });
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toBe('');
  expect(result.stderr.toString()).toBe(
    'FAIL: Unknown arguments. Use --help.\n',
  );
});

test.each(['0', '65536', 'abc'])(
  'invalid local port %s has exact output',
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

test('full canonical SQL equals exactly one CLI migration; no extra workflow table', () => {
  const migrations = readdirSync(`${root}supabase/migrations/archive`).filter(
    (name) => name.endsWith('_shipment_transfer_coordination.sql'),
  );
  expect(migrations).toHaveLength(1);
  const sql = readFileSync(
    `${root}supabase/migrations/archive/${migrations[0]}`,
    'utf8',
  );
  // The canonical file equals the archived migration except for
  // fn_complete_shipment_transfer, which later migrations redefine (seller notice, then
  // its shipment link in expo-push-notifications T13); it equals the newest one.
  const lf = (text: string) => text.replace(/\r\n/g, '\n');
  const completeDefinition = (text: string) => {
    const start = text.indexOf(
      'CREATE OR REPLACE FUNCTION public.fn_complete_shipment_transfer(',
    );
    const end = text.indexOf('\n$$;', start) + 4;
    return { start, end, body: text.slice(start, end) };
  };
  const withoutComplete = (text: string, d: { start: number; end: number }) =>
    text.slice(0, d.start) + text.slice(d.end);
  const canonical = lf(
    readFileSync(
      `${root}supabase/queries/payments/shipment_transfer_coordination.sql`,
      'utf8',
    ),
  );
  const archived = completeDefinition(lf(sql));
  const current = completeDefinition(canonical);
  const redefinitions = readdirSync(`${root}supabase/migrations`).filter(
    (name) => name.endsWith('_shipment_funds_released_notice_link.sql'),
  );
  expect(redefinitions).toHaveLength(1);
  const redefined = completeDefinition(
    lf(readFileSync(`${root}supabase/migrations/${redefinitions[0]}`, 'utf8')),
  );
  expect(archived.start).toBeGreaterThan(-1);
  expect(current.body).toBe(redefined.body);
  expect(current.body).not.toBe(archived.body);
  expect(withoutComplete(canonical, current)).toBe(
    withoutComplete(lf(sql), archived),
  );
  expect(sql).not.toMatch(/CREATE TABLE/i);
  expect(sql.match(/CREATE OR REPLACE FUNCTION public\.[a-z_]+/g)).toEqual([
    'CREATE OR REPLACE FUNCTION public.fn_begin_shipment_transfer',
    'CREATE OR REPLACE FUNCTION public.fn_complete_shipment_transfer',
    'CREATE OR REPLACE FUNCTION public.fn_claim_shipment_cancellation',
    'CREATE OR REPLACE FUNCTION public.fn_start_shipment_cancellation',
  ]);
  expect(sql).toContain('FROM PUBLIC, anon, authenticated, service_role');
});
