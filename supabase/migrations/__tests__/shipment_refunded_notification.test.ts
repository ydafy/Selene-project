import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withoutShipmentLink } from './shipmentNoticeLink';

/**
 * Static guards for the buyer refund notice (expo-push-notifications T6b/S4).
 * These tests read SQL text; `supabase db reset` and the psql probes in the task log
 * prove the SQL runs and which rows each path writes.
 */

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter(
  (name) => name.endsWith('_shipment_refunded_notification.sql'),
);
const migration =
  migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const collapse = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const open = migration.indexOf('$$');
const body =
  open === -1
    ? ''
    : migration.slice(open + 2, migration.indexOf('\n$$;', open));
const SIGNATURE = 'fn_record_dispute_refund(uuid, text)';

// The 15 kinds of the funds released migration plus the new one. Never drop a kind.
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
  'shipment.refunded',
];

describe('shipment refunded notification migration (SQL text)', () => {
  test('is one migration after the funds released migration, in one transaction', () => {
    expect(migrations).toHaveLength(1);
    expect(
      migrations[0]! >
        '20261030233800_shipment_funds_released_notification.sql',
    ).toBe(true);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd()).toEndWith('COMMIT;');
  });

  test('extends the event kind catalogue to exactly 16 kinds', () => {
    const check = migration.match(
      /ADD CONSTRAINT notifications_event_kind_catalogue_chk\s+CHECK \(event_kind IS NULL OR event_kind IN \(([\s\S]*?)\)\);/,
    )?.[1];
    expect(check).toBeDefined();
    const kinds = [...check!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(kinds).toHaveLength(16);
    expect(kinds.sort()).toEqual([...CATALOGUE].sort());
  });

  test('pushes the notice to the buyer on the orders channel', () => {
    const insert = collapse(
      migration.match(/INSERT INTO public\.push_event_policy[\s\S]*?;/)?.[0] ??
        '',
    );
    expect(insert).toBe(
      "INSERT INTO public.push_event_policy (event_kind, recipient_role, channel) VALUES ('shipment.refunded', 'buyer', 'orders');",
    );
  });

  test('keeps the canonical file equal to the migration body', () => {
    expect(body).not.toBe('');
    expect(
      collapse(
        withoutShipmentLink(
          read('supabase/queries/disputes/fn_record_dispute_refund.sql'),
        ),
      ),
    ).toBe(collapse(body));
  });

  test('writes the notice only on the branch that refunds the shipment, after resolving the dispute', () => {
    const replay = body.indexOf("'ALREADY_RECORDED'");
    const refusal = body.indexOf("'SHIPMENT_NOT_REFUNDABLE:'");
    const shipmentUpdate = body.indexOf('UPDATE public.shipments');
    const disputeUpdate = body.indexOf('UPDATE public.disputes');
    const recorded = body.indexOf("'Dispute refund recorded'");
    const notice = body.indexOf('INSERT INTO public.notifications');
    const exception = body.indexOf('EXCEPTION WHEN OTHERS THEN');
    const done = body.indexOf('RETURN QUERY SELECT true, NULL::TEXT;');
    expect(replay).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(replay);
    expect(shipmentUpdate).toBeGreaterThan(refusal);
    expect(disputeUpdate).toBeGreaterThan(shipmentUpdate);
    expect(recorded).toBeGreaterThan(disputeUpdate);
    expect(notice).toBeGreaterThan(recorded);
    expect(body.slice(recorded, notice)).toContain('BEGIN');
    expect(exception).toBeGreaterThan(notice);
    expect(done).toBeGreaterThan(exception);
    expect(body.slice(0, shipmentUpdate)).not.toContain('public.notifications');
    expect(body.match(/INSERT INTO public\.notifications/g)).toHaveLength(1);
    expect(body.match(/shipment\.refunded/g)).toHaveLength(2);
  });

  test('a failing notice is logged as a warning, itself guarded, and does not roll back the refund record', () => {
    const handler = collapse(
      body.slice(body.indexOf('EXCEPTION WHEN OTHERS THEN')),
    );
    expect(handler).toStartWith(
      "EXCEPTION WHEN OTHERS THEN BEGIN INSERT INTO public.system_logs (level, message, metadata) VALUES ('WARNING', 'Refund notice failed', jsonb_build_object('dispute_id', p_dispute_id, 'shipment_id', v_shipment_id, 'sqlstate', SQLSTATE, 'error', SQLERRM)); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Refund notice failed and could not be logged: %', SQLERRM; END; END;",
    );
  });

  test('the notice carries the buyer identity, payload, copy, path and idempotency key', () => {
    const notice = collapse(
      body.slice(
        body.indexOf('INSERT INTO public.notifications'),
        body.indexOf('EXCEPTION WHEN OTHERS THEN'),
      ),
    );
    expect(notice).toContain(
      'FROM public.shipments AS s JOIN public.orders AS o',
    );
    expect(notice).toContain('o.buyer_id');
    expect(notice).toContain("'shipment.refunded'");
    expect(notice).toContain("'shipment.refunded:' || v_shipment_id::text");
    expect(notice).toContain(
      "jsonb_build_object('shipment_id', v_shipment_id, 'order_id', s.order_id, 'dispute_id', p_dispute_id, 'recipient_role', 'buyer')",
    );
    expect(notice).toContain("'success'");
    expect(notice).toContain("'Te devolvimos tu dinero'");
    expect(notice).toContain(
      "'Reembolsamos tu compra a tu método de pago. Puede tardar de 5 a 10 días hábiles en verse en tu estado de cuenta.'",
    );
    expect(notice).toContain("'/profile/orders/' || s.order_id::text");
    expect(notice).toContain(
      'ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING',
    );
  });

  test('stays SECURITY DEFINER with an empty search path and restates service-only grants', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path TO ''");
    expect(migration).toContain(
      `REVOKE ALL ON FUNCTION public.${SIGNATURE} FROM PUBLIC, anon, authenticated;`,
    );
    expect(migration).toContain(
      `GRANT EXECUTE ON FUNCTION public.${SIGNATURE} TO service_role;`,
    );
    expect(migration).not.toMatch(/TO (anon|authenticated|PUBLIC)/);
  });
});
