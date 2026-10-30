import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for the buyer shipment milestone notices (expo-push-notifications T4/S4).
 * These tests read SQL text; `supabase db reset` and the Bruno requests in
 * bruno/push/milestones-* prove the SQL runs and which rows each path writes.
 */

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter(
  (name) => name.endsWith('_shipment_milestone_notifications.sql'),
);
const migration =
  migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const collapse = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const definition = (sql: string, name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = sql.indexOf('\n$$;', start);
  return start === -1 || end === -1 ? '' : sql.slice(start, end + 4);
};
const bodyOf = (sql: string) => {
  const open = sql.indexOf('AS $$\n');
  return open === -1 ? sql : sql.slice(open + 6, sql.lastIndexOf('\n$$;'));
};
/** The text of one IF/ELSIF branch, from its condition to the next ELSIF, ELSE or END IF. */
const branch = (sql: string, condition: string) => {
  const start = sql.indexOf(condition);
  if (start === -1) return '';
  const rest = sql.slice(start + condition.length);
  const end = rest.search(/\n {2}(ELSIF|ELSE|END IF)/);
  return end === -1 ? '' : rest.slice(0, end);
};

const tracking = definition(migration, 'fn_record_tracking_event');
const mark = definition(migration, 'fn_mark_shipment_delivered');

// Every kind already allowed on the remote project (read through the Supabase MCP on
// 2026-10-30), plus the two new ones. The remote is shared by all branches: never drop one.
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
];

describe('shipment milestone notifications migration (SQL text)', () => {
  test('is one migration after the push receipts migration, in one transaction', () => {
    expect(migrations).toHaveLength(1);
    expect(migrations[0]! > '20261030025554_push_receipts_and_purge.sql').toBe(
      true,
    );
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd()).toEndWith('COMMIT;');
  });

  test('extends the event kind catalogue without dropping a kind', () => {
    const check = migration.match(
      /ADD CONSTRAINT notifications_event_kind_catalogue_chk\s+CHECK \(event_kind IS NULL OR event_kind IN \(([\s\S]*?)\)\);/,
    )?.[1];
    expect(check).toBeDefined();
    const kinds = [...check!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(kinds.sort()).toEqual([...CATALOGUE].sort());
  });

  test('pushes both kinds to the buyer only, on the orders channel', () => {
    const insert = collapse(
      migration.match(/INSERT INTO public\.push_event_policy[\s\S]*?;/)?.[0] ??
        '',
    );
    expect(insert).toBe(
      "INSERT INTO public.push_event_policy (event_kind, recipient_role, channel) VALUES ('shipment.in_transit', 'buyer', 'orders'), ('shipment.delivered', 'buyer', 'orders');",
    );
  });

  test('keeps each redefined function equal to its canonical file', () => {
    expect(tracking).not.toBe('');
    expect(mark).not.toBe('');
    expect(
      read('supabase/queries/tracking/fn_record_tracking_event.sql'),
    ).toContain(tracking);
    expect(
      collapse(
        read('supabase/queries/shipments/fn_mark_shipment_delivered.sql'),
      ),
    ).toBe(collapse(bodyOf(mark)));
  });

  test('fn_record_tracking_event notifies the buyer only on the status it moves', () => {
    const shipped = branch(
      tracking,
      "ELSIF p_dispute_id IS NULL AND v_status = 'preparing' AND p_transition = 'shipped' THEN",
    );
    const delivered = branch(
      tracking,
      "ELSIF p_dispute_id IS NULL AND v_status = 'shipped' AND p_transition = 'delivered' THEN",
    );
    const refundStarted = branch(
      tracking,
      'IF p_dispute_id IS NULL AND v_refund_started THEN',
    );

    expect(shipped).toContain("SET status = 'shipped'");
    expect(shipped).toContain(
      "PERFORM public.fn_notify_shipment_milestone(p_shipment_id, 'shipment.in_transit');",
    );
    expect(shipped).not.toContain('shipment.delivered');
    expect(delivered).toContain("SET status = 'delivered'");
    expect(delivered).toContain(
      "PERFORM public.fn_notify_shipment_milestone(p_shipment_id, 'shipment.delivered');",
    );
    expect(delivered).not.toContain('shipment.in_transit');
    expect(refundStarted).not.toContain('fn_notify_shipment_milestone');
    expect(tracking.match(/fn_notify_shipment_milestone/g)).toHaveLength(2);
  });

  test('fn_mark_shipment_delivered notifies the buyer after it moves the status', () => {
    const body = bodyOf(mark);
    const update = body.indexOf("SET status = 'delivered'");
    const notify = body.indexOf(
      "PERFORM public.fn_notify_shipment_milestone(p_shipment_id, 'shipment.delivered');",
    );
    expect(update).toBeGreaterThan(-1);
    expect(notify).toBeGreaterThan(update);
    expect(notify).toBeLessThan(
      body.indexOf('RETURN QUERY SELECT true, NULL::TEXT;'),
    );
    expect(body.match(/fn_notify_shipment_milestone/g)).toHaveLength(1);
  });

  test('the helper writes one buyer notice per shipment and kind', () => {
    const helper = definition(migration, 'fn_notify_shipment_milestone');
    expect(helper).not.toBe('');
    expect(
      read('supabase/queries/shipments/fn_notify_shipment_milestone.sql'),
    ).toContain(helper);
    expect(helper).toContain('SECURITY DEFINER');
    expect(helper).toContain("SET search_path TO 'public', 'pg_temp'");
    expect(helper).toContain("p_event_kind || ':' || p_shipment_id::text");
    expect(helper).toContain("'recipient_role', 'buyer'");
    expect(helper).toContain("'/profile/orders/' || v_order_id::text");
    expect(helper).toContain(
      'ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING',
    );
    expect(helper).toContain("RAISE EXCEPTION 'INVALID_SHIPMENT_MILESTONE'");
    expect(helper).not.toContain('seller_id');
  });

  test('restates service-only grants and grants nothing to clients', () => {
    const signatures = [
      'fn_record_tracking_event(uuid, uuid, public.shipment_tracking_event_type, timestamp with time zone, text, text, text, text, uuid, uuid, public.order_status_enum)',
      'fn_mark_shipment_delivered(uuid)',
    ];
    for (const signature of signatures) {
      const escaped = signature.replace(/[()]/g, '\\$&');
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${escaped} FROM PUBLIC, anon, authenticated;`,
        ),
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`,
      );
    }
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.fn_notify_shipment_milestone(uuid, text) FROM PUBLIC, anon, authenticated, service_role;',
    );
    expect(migration).not.toMatch(/GRANT [^;]*fn_notify_shipment_milestone/);
    expect(migration).not.toMatch(/TO (anon|authenticated|PUBLIC)/);
  });
});
