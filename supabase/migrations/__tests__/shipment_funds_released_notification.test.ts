import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withoutShipmentLink } from './shipmentNoticeLink';

/**
 * Static guards for the seller funds released notice (expo-push-notifications T5/S4).
 * These tests read SQL text; `supabase db reset` and the psql probes in the task log
 * prove the SQL runs and which rows each path writes.
 */

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter(
  (name) => name.endsWith('_shipment_funds_released_notification.sql'),
);
const migration =
  migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const collapse = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const definition = (sql: string, name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = sql.indexOf('\n$$;', start);
  return start === -1 || end === -1 ? '' : sql.slice(start, end + 4);
};

const complete = definition(migration, 'fn_complete_shipment_transfer');
const SIGNATURE =
  'fn_complete_shipment_transfer(UUID, UUID, INTEGER, UUID, TEXT)';

// The 14 kinds of the milestone notifications migration (equal to the remote project, read
// through the Supabase MCP on 2026-10-30), plus the new one. Never drop a kind.
const CATALOGUE = [
  'order.payment_confirmed',
  'shipment.cancelled',
  'shipment.refund_failed',
  'dispute.opened',
  'dispute.verdict',
  'product.approved',
  'product.approved_with_note',
  'product.rejected',
  'return.seller_evidence_submitted',
  'return.delivered',
  'product.available',
  'product.interest',
  'shipment.in_transit',
  'shipment.delivered',
  'shipment.funds_released',
];

describe('shipment funds released notification migration (SQL text)', () => {
  test('is one migration after the milestone notifications migration, in one transaction', () => {
    expect(migrations).toHaveLength(1);
    expect(
      migrations[0]! > '20261030214855_shipment_milestone_notifications.sql',
    ).toBe(true);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd()).toEndWith('COMMIT;');
  });

  test('extends the event kind catalogue to exactly 15 kinds', () => {
    const check = migration.match(
      /ADD CONSTRAINT notifications_event_kind_catalogue_chk\s+CHECK \(event_kind IS NULL OR event_kind IN \(([\s\S]*?)\)\);/,
    )?.[1];
    expect(check).toBeDefined();
    const kinds = [...check!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(kinds).toHaveLength(15);
    expect(kinds.sort()).toEqual([...CATALOGUE].sort());
  });

  test('pushes the notice to the seller on the orders channel', () => {
    const insert = collapse(
      migration.match(/INSERT INTO public\.push_event_policy[\s\S]*?;/)?.[0] ??
        '',
    );
    expect(insert).toBe(
      "INSERT INTO public.push_event_policy (event_kind, recipient_role, channel) VALUES ('shipment.funds_released', 'seller', 'orders');",
    );
  });

  test('keeps the migration definition equal to the canonical file', () => {
    expect(complete).not.toBe('');
    expect(
      withoutShipmentLink(
        read('supabase/queries/payments/shipment_transfer_coordination.sql'),
      ),
    ).toContain(complete);
  });

  test('writes the seller notice only after recording the transfer, in its own subtransaction', () => {
    const replay = complete.indexOf(
      'RETURN v_shipment.stripe_transfer_id = p_stripe_transfer_id;',
    );
    const update = complete.indexOf(
      'UPDATE public.shipments SET stripe_transfer_id = p_stripe_transfer_id WHERE id = p_shipment_id;',
    );
    const notice = complete.indexOf('INSERT INTO public.notifications');
    const exception = complete.indexOf('EXCEPTION WHEN OTHERS THEN');
    const fence = complete.indexOf(
      '-- Never clear the possible-effect fence, including on idempotent completion.',
    );
    expect(replay).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(replay);
    expect(notice).toBeGreaterThan(update);
    expect(complete.slice(update, notice)).toContain('BEGIN');
    expect(exception).toBeGreaterThan(notice);
    expect(fence).toBeGreaterThan(exception);
    expect(complete.slice(0, update)).not.toContain('public.notifications');
    expect(complete.match(/INSERT INTO public\.notifications/g)).toHaveLength(
      1,
    );
    expect(complete.match(/shipment\.funds_released/g)).toHaveLength(2);
    expect(complete.match(/RETURN false;/g)).toHaveLength(6);
  });

  test('a failing notice is logged as a warning and does not roll back the transfer', () => {
    const handler = collapse(
      complete.slice(complete.indexOf('EXCEPTION WHEN OTHERS THEN')),
    );
    expect(handler).toStartWith(
      "EXCEPTION WHEN OTHERS THEN INSERT INTO public.system_logs (level, message, metadata) VALUES ('WARNING', 'Funds released notice failed', jsonb_build_object('shipment_id', p_shipment_id, 'sqlstate', SQLSTATE, 'error', SQLERRM)); END;",
    );
  });

  test('the notice carries the seller identity, payload, copy, path and idempotency key', () => {
    const notice = collapse(
      complete.slice(
        complete.indexOf('INSERT INTO public.notifications'),
        complete.indexOf('EXCEPTION WHEN OTHERS THEN'),
      ),
    );
    expect(notice).toContain('v_shipment.seller_id');
    expect(notice).toContain("'shipment.funds_released'");
    expect(notice).toContain(
      "'shipment.funds_released:' || p_shipment_id::text",
    );
    expect(notice).toContain(
      "jsonb_build_object('order_id', v_shipment.order_id, 'shipment_id', p_shipment_id, 'amount_cents', v_mapping.net_payout, 'currency', 'mxn', 'recipient_role', 'seller')",
    );
    expect(notice).toContain("'success'");
    expect(notice).toContain("'Liberamos el pago de tu venta'");
    expect(notice).toContain(
      "'Enviamos $' || to_char(v_mapping.net_payout / 100.0, 'FM999,999,990.00') || ' MXN a tu cuenta de vendedor. El depósito a tu banco puede tardar unos días hábiles.'",
    );
    expect(notice).toContain("'/profile/orders/' || v_shipment.order_id::text");
    expect(notice).toContain(
      'ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING',
    );
  });

  test('stays SECURITY DEFINER with an empty search path and restates service-only grants', () => {
    expect(complete).toContain("SECURITY DEFINER SET search_path = ''");
    expect(migration).toContain(
      `REVOKE EXECUTE ON FUNCTION public.${SIGNATURE} FROM PUBLIC, anon, authenticated;`,
    );
    expect(migration).toContain(
      `GRANT EXECUTE ON FUNCTION public.${SIGNATURE} TO service_role;`,
    );
    expect(migration).not.toMatch(/TO (anon|authenticated|PUBLIC)/);
  });
});
