import { expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';

const migrationDirectory = 'supabase/migrations';
const canonicalFunctionPath =
  'supabase/queries/orders/fn_confirm_shipment_delivery.sql';
const legacyFunctionPath = 'supabase/queries/orders/fn_confirm_delivery.sql';

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
  expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.shipment_completion_events');
  expect(migration).toContain('UNIQUE (shipment_id)');
  expect(migration).toContain('UNIQUE (idempotency_key)');
  expect(migration).toContain("source IN ('buyer', 'auto')");
  expect(migration).toContain(
    "(source = 'buyer' AND actor_id IS NOT NULL) OR (source = 'auto' AND actor_id IS NULL)",
  );
  expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
  expect(migration).toContain('WHERE status = \'delivered\'');
  expect(migration).toContain('AND buyer_confirmed_at IS NULL');
});

test('canonical RPC enforces source-specific completion before one durable audit', async () => {
  const migration = await readMigration();
  const canonicalFunction = await readFile(canonicalFunctionPath, 'utf8');

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
  expect(canonicalFunction).toContain("v_status = 'delivered'");
  expect(canonicalFunction).toContain("p_source = 'auto'");
  expect(canonicalFunction).toContain('INSERT INTO public.shipment_completion_events');
});

test('canonical RPC rejects active disputes before inserting a completion event', async () => {
  const canonicalFunction = await readFile(canonicalFunctionPath, 'utf8');

  expect(canonicalFunction).toMatch(
    /IF EXISTS\s*\(\s*SELECT 1\s+FROM public\.disputes AS dispute\s+WHERE dispute\.shipment_id = p_shipment_id\s+AND dispute\.status NOT IN \('resolved', 'rejected'\)\s*\)\s*THEN\s+RETURN QUERY SELECT false, 'SHIPMENT_HAS_ACTIVE_DISPUTE'/i,
  );
  expect(canonicalFunction.indexOf('SHIPMENT_HAS_ACTIVE_DISPUTE')).toBeLessThan(
    canonicalFunction.indexOf('INSERT INTO public.shipment_completion_events'),
  );
});

test('canonical RPC validates the buyer actor against the locked shipment order', async () => {
  const canonicalFunction = await readFile(canonicalFunctionPath, 'utf8');

  expect(canonicalFunction).toMatch(
    /IF p_source = 'buyer' THEN\s+SELECT buyer_id INTO v_buyer_id\s+FROM public\.orders\s+WHERE id = v_order_id/i,
  );
  expect(canonicalFunction).toMatch(
    /IF p_actor_id IS NULL OR v_buyer_id IS DISTINCT FROM p_actor_id THEN\s+RETURN QUERY SELECT false, 'BUYER_REQUIRED'/i,
  );
});

test('canonical RPC enforces actor and idempotency-key rules for each completion source', async () => {
  const canonicalFunction = await readFile(canonicalFunctionPath, 'utf8');

  expect(canonicalFunction).toMatch(
    /p_source = 'buyer'\s+AND p_idempotency_key <> 'confirm_shipment_' \|\| p_shipment_id::text/i,
  );
  expect(canonicalFunction).toMatch(
    /p_source = 'auto'\s+AND p_idempotency_key <> 'auto_completion_' \|\| p_shipment_id::text/i,
  );
  expect(canonicalFunction).toMatch(
    /ELSIF p_actor_id IS NOT NULL OR v_buyer_confirmed_at IS NOT NULL THEN\s+RETURN QUERY SELECT false, 'AUTO_COMPLETION_NOT_DUE'/i,
  );
  expect(canonicalFunction).toMatch(
    /ELSIF v_delivered_at IS NULL\s+OR NOT \(v_delivered_at <= now\(\) - interval '48 hours'\) THEN\s+RETURN QUERY SELECT false, 'AUTO_COMPLETION_NOT_DUE'/i,
  );
});

test('canonical RPC timestamps only explicit buyer completion and preserves auto NULL', async () => {
  const canonicalFunction = await readFile(canonicalFunctionPath, 'utf8');

  expect(canonicalFunction).toMatch(
    /buyer_confirmed_at = CASE\s+WHEN p_source = 'buyer' THEN v_completed_at\s+ELSE buyer_confirmed_at\s+END/i,
  );
  expect(canonicalFunction).toMatch(
    /p_source = 'auto'[\s\S]*p_actor_id IS NOT NULL OR v_buyer_confirmed_at IS NOT NULL[\s\S]*AUTO_COMPLETION_NOT_DUE/i,
  );
});

test('completion preserves non-Connect accounting and blocks deprecated wallet writes for Connect', async () => {
  const canonicalFunction = await readFile(canonicalFunctionPath, 'utf8');

  expect(canonicalFunction).toContain('v_is_connect BOOLEAN');
  expect(canonicalFunction).toContain('stripe_payment_intent_id IS NOT NULL');
  expect(canonicalFunction).toContain('IF NOT v_is_connect THEN');
  expect(canonicalFunction).toContain('UPDATE public.wallets');
  expect(canonicalFunction).toContain('INSERT INTO public.wallet_transactions');
  expect(canonicalFunction).toContain("'INFO'");
  expect(canonicalFunction).toContain('Connect shipment completion skipped deprecated wallet release');
});

test('migration restricts RPC execution and retires the legacy order-level path', async () => {
  const migration = await readMigration();

  expect(migration).toContain(
    'REVOKE ALL ON FUNCTION public.fn_confirm_shipment_delivery(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated',
  );
  expect(migration).toContain(
    'GRANT EXECUTE ON FUNCTION public.fn_confirm_shipment_delivery(uuid, text, uuid, text) TO service_role',
  );
  expect(migration).toContain('DROP FUNCTION IF EXISTS public.fn_confirm_delivery(uuid)');
  await expect(readFile(legacyFunctionPath, 'utf8')).rejects.toThrow();
});
