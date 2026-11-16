import { expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = 'scripts/verify/test-shipment-transfer-coordination.ts';

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

test('transfer coordination is exactly one CLI migration; no extra workflow table', () => {
  const migrations = readdirSync(`${root}supabase/migrations/archive`).filter(
    (name) => name.endsWith('_shipment_transfer_coordination.sql'),
  );
  expect(migrations).toHaveLength(1);
  const sql = readFileSync(
    `${root}supabase/migrations/archive/${migrations[0]}`,
    'utf8',
  );
  // Later changes redefine fn_complete_shipment_transfer (seller notice, its shipment
  // link, cents columns); the harness loads the current body from the declarative schema.
  const lf = (text: string) => text.replace(/\r\n/g, '\n');
  const completeDefinition = (text: string, header: string, end: string) => {
    const start = text.indexOf(header);
    return {
      start,
      body: text.slice(start, text.indexOf(end, start) + end.length),
    };
  };
  const archived = completeDefinition(
    lf(sql),
    'CREATE OR REPLACE FUNCTION public.fn_complete_shipment_transfer(',
    '\n$$;',
  );
  const redefined = completeDefinition(
    lf(
      readFileSync(
        `${root}supabase/schemas/public/functions/fn_complete_shipment_transfer.sql`,
        'utf8',
      ),
    ),
    'CREATE OR REPLACE FUNCTION public.fn_complete_shipment_transfer (',
    '\n$function$;',
  );
  expect(archived.start).toBeGreaterThan(-1);
  expect(redefined.start).toBeGreaterThan(-1);
  expect(redefined.body).not.toBe(archived.body);
  expect(sql).not.toMatch(/CREATE TABLE/i);
  expect(sql.match(/CREATE OR REPLACE FUNCTION public\.[a-z_]+/g)).toEqual([
    'CREATE OR REPLACE FUNCTION public.fn_begin_shipment_transfer',
    'CREATE OR REPLACE FUNCTION public.fn_complete_shipment_transfer',
    'CREATE OR REPLACE FUNCTION public.fn_claim_shipment_cancellation',
    'CREATE OR REPLACE FUNCTION public.fn_start_shipment_cancellation',
  ]);
  expect(sql).toContain('FROM PUBLIC, anon, authenticated, service_role');
});

test('harness runs the current schema; archived bodies only for the pre-transfer differential', () => {
  const harness = readFileSync(`${root}${script}`, 'utf8');
  const schemaPaths = [...harness.matchAll(/schema\('([^']+)'\)/g)].map(
    (match) => match[1],
  );
  for (const name of [
    'fn_begin_shipment_transfer',
    'fn_complete_shipment_transfer',
    'fn_claim_shipment_cancellation',
    'fn_start_shipment_cancellation',
    'fn_start_shipment_cancellation_refund',
    'fn_atomic_payout_resume_mapping',
    'fn_begin_manual_payout_create_fence',
    'fn_get_connect_account_actionability',
  ])
    expect(schemaPaths).toContain(`public/functions/${name}.sql`);
  expect(schemaPaths).toContain(
    'public/views/admin_connect_payout_release_view.sql',
  );
  for (const path of schemaPaths)
    expect(existsSync(`${root}supabase/schemas/${path}`)).toBe(true);
  // Only the B1.1 claim/start bodies that preceded the transfer fences stay archived.
  expect(
    [...harness.matchAll(/supabase\/migrations\/[^'`]+/g)].map((m) => m[0]),
  ).toEqual([
    'supabase/migrations/archive/20261016011954_shipment_cancellation_coordination.sql',
  ]);
});
