import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withoutShipmentLink } from './shipmentNoticeLink';

/**
 * Static guards for the seller label deadline reminder (expo-push-notifications T7/S4).
 * These tests read SQL text; `supabase db reset`, the psql probes in the task log, Bruno
 * and scripts/test-auto-cancel-paid-timeout.ts prove which shipments get a notice.
 */

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter(
  (name) => name.endsWith('_shipment_label_deadline_notification.sql'),
);
const migration =
  migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const collapse = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const fnStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.fn_notify_label_deadline_reminders',
);
const fnEnd = migration.indexOf('\n$$;', fnStart);
const definition =
  fnStart === -1 || fnEnd === -1 ? '' : migration.slice(fnStart, fnEnd + 4);
const body = definition.slice(definition.indexOf('$$') + 2);
const SIGNATURE = 'fn_notify_label_deadline_reminders()';

// The 16 kinds of the shipment refunded migration plus the new one. Never drop a kind.
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
  'shipment.label_deadline',
];

describe('shipment label deadline notification migration (SQL text)', () => {
  test('is one migration after the T6 migrations, in one transaction', () => {
    expect(migrations).toHaveLength(1);
    expect(
      migrations[0]! >
        '20261101031000_dispute_shipping_timeout_verdict_notice.sql',
    ).toBe(true);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd()).toEndWith('COMMIT;');
  });

  test('extends the event kind catalogue to exactly 17 kinds', () => {
    const check = migration.match(
      /ADD CONSTRAINT notifications_event_kind_catalogue_chk\s+CHECK \(event_kind IS NULL OR event_kind IN \(([\s\S]*?)\)\);/,
    )?.[1];
    expect(check).toBeDefined();
    const kinds = [...check!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(kinds).toHaveLength(17);
    expect(kinds.sort()).toEqual([...CATALOGUE].sort());
  });

  test('pushes the reminder to the seller on the orders channel', () => {
    const insert = collapse(
      migration.match(/INSERT INTO public\.push_event_policy[\s\S]*?;/)?.[0] ??
        '',
    );
    expect(insert).toBe(
      "INSERT INTO public.push_event_policy (event_kind, recipient_role, channel) VALUES ('shipment.label_deadline', 'seller', 'orders');",
    );
  });

  test('keeps the canonical file equal to the migration function and grants', () => {
    expect(definition).not.toBe('');
    const canonical = withoutShipmentLink(
      read('supabase/queries/shipments/fn_notify_label_deadline_reminders.sql'),
    );
    const fromMigration = migration.slice(
      fnStart,
      migration.indexOf('INSERT INTO public.push_event_policy'),
    );
    expect(
      collapse(
        canonical.slice(canonical.indexOf('CREATE OR REPLACE FUNCTION')),
      ),
    ).toBe(collapse(fromMigration));
  });

  test('is service-role only, SECURITY DEFINER with an empty search path and returns the count', () => {
    expect(definition).toContain('RETURNS integer');
    expect(definition).toContain('SECURITY DEFINER');
    expect(definition).toContain("SET search_path TO ''");
    expect(collapse(body)).toContain(
      "IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'fn_notify_label_deadline_reminders is service-role only' USING ERRCODE = '42501';",
    );
    expect(body).toContain('GET DIAGNOSTICS v_count = ROW_COUNT;');
    expect(migration).toContain(
      `REVOKE ALL ON FUNCTION public.${SIGNATURE} FROM PUBLIC, anon, authenticated;`,
    );
    expect(migration).toContain(
      `GRANT EXECUTE ON FUNCTION public.${SIGNATURE} TO service_role;`,
    );
    expect(migration).not.toMatch(/TO (anon|authenticated|PUBLIC)/);
  });

  test('reads the live expiration setting and refuses an invalid one', () => {
    const sql = collapse(body);
    expect(sql).toContain(
      'SELECT ss.order_expiration_hours INTO v_hours FROM public.system_settings AS ss WHERE ss.id = 1;',
    );
    expect(sql).toContain(
      "IF v_hours IS NULL OR v_hours <= 0 THEN RAISE EXCEPTION 'AUTO_CANCEL_SETTINGS_INVALID';",
    );
  });

  test('selects only shipments the paid timeout would cancel within the next 12 hours', () => {
    const sql = collapse(body);
    expect(sql).toContain("s.status = 'paid'");
    expect(sql).toContain('s.tracking_number IS NULL');
    expect(sql).toContain(
      "s.label_generation_state IN ('unclaimed', 'retryable_rejected')",
    );
    expect(sql).toContain(
      's.created_at + pg_catalog.make_interval(hours => v_hours) AS deadline_at',
    );
    expect(sql).toContain(
      "d.deadline_at > v_now AND d.deadline_at <= v_now + interval '12 hours'",
    );
    expect(sql).toContain(
      'NOT EXISTS ( SELECT 1 FROM public.shipment_cancellation_operations AS op WHERE op.shipment_id = s.id AND (op.external_started_at IS NOT NULL OR op.claim_expires_at > v_now) )',
    );
  });

  test('the notice carries the seller identity, payload, copy, path and idempotency key', () => {
    const sql = collapse(body);
    expect(sql).toContain('d.seller_id');
    expect(sql).toContain("'shipment.label_deadline'");
    expect(sql).toContain("'shipment.label_deadline:' || d.id::text");
    expect(sql).toContain(
      "jsonb_build_object('shipment_id', d.id, 'order_id', d.order_id, 'deadline_at', d.deadline_at, 'recipient_role', 'seller')",
    );
    expect(sql).toContain("'warning'");
    expect(sql).toContain("'Genera la guía de tu venta'");
    expect(sql).toContain(
      "'Si no generas la guía en ' || CASE WHEN d.hours_left = 1 THEN '1 hora' ELSE d.hours_left::text || ' horas' END || ', cancelaremos la venta y reembolsaremos al comprador.'",
    );
    expect(sql).toContain("'/profile/orders/' || d.order_id::text");
    expect(sql).toContain(
      'ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING',
    );
    expect(body.match(/INSERT INTO public\.notifications/g)).toHaveLength(1);
  });
});
