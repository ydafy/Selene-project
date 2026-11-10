import { expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';

const migrationDirectory = 'supabase/migrations/archive';

async function readMigration(): Promise<string> {
  const migrationFiles = (await readdir(migrationDirectory)).filter((file) =>
    /^\d+_confirm_shipment_hardening\.sql$/.test(file),
  );

  expect(migrationFiles).toHaveLength(1);

  return readFile(`${migrationDirectory}/${migrationFiles[0]}`, 'utf8');
}

test('migration adds the completion ledger and due index', async () => {
  const migration = await readMigration();

  expect(migration).toContain(
    'ADD COLUMN IF NOT EXISTS buyer_confirmed_at timestamptz',
  );
  expect(migration).toContain(
    'CREATE TABLE IF NOT EXISTS public.shipment_completion_events',
  );
  expect(migration).toContain('UNIQUE (shipment_id)');
  expect(migration).toContain('UNIQUE (idempotency_key)');
  expect(migration).toContain("source IN ('buyer', 'auto')");
  expect(migration).toContain(
    "(source = 'buyer' AND actor_id IS NOT NULL) OR (source = 'auto' AND actor_id IS NULL)",
  );
  expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
  expect(migration).toContain("WHERE status = 'delivered'");
  expect(migration).toContain('AND buyer_confirmed_at IS NULL');
});

test('migration RPC enforces source-specific completion before one durable audit', async () => {
  const migration = await readMigration();

  expect(migration).toContain(
    'CREATE OR REPLACE FUNCTION public.fn_confirm_shipment_delivery(',
  );
  expect(migration).toContain('SECURITY DEFINER');
  expect(migration).toContain("SET search_path = ''");
  expect(migration).toContain("current_setting('request.jwt.claims', true)");
  expect(migration).toContain('FOR UPDATE');
  expect(migration).toContain("v_status = 'delivered'");
  expect(migration).toContain('p_source IS NULL OR p_source NOT IN');
  expect(migration).toContain("p_source = 'buyer'");
  expect(migration).toContain("p_source = 'auto'");
  expect(migration).toContain("v_delivered_at <= now() - interval '48 hours'");
  expect(migration).toContain('COMPLETION_AUDIT_MISSING');
  expect(migration).toContain('INSERT INTO public.shipment_completion_events');
});

test('migration restricts RPC execution and retires the legacy order-level path', async () => {
  const migration = await readMigration();

  expect(migration).toContain(
    'REVOKE ALL ON FUNCTION public.fn_confirm_shipment_delivery(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated',
  );
  expect(migration).toContain(
    'GRANT EXECUTE ON FUNCTION public.fn_confirm_shipment_delivery(uuid, text, uuid, text) TO service_role',
  );
  expect(migration).toContain(
    'DROP FUNCTION IF EXISTS public.fn_confirm_delivery(uuid)',
  );
});
