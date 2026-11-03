import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for expo-push-notifications T13: a notice about one shipment links to
 * /profile/orders/<order>?shipment_id=<shipment>, so the app opens that shipment and
 * not the order summary. These tests read SQL text; `supabase db reset` and the Bruno
 * requests prove the SQL runs and which action_path each producer writes.
 */

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrationNames = readdirSync(join(root, 'supabase/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort();

/** The body of the last CREATE OR REPLACE of a function in one SQL text. */
const bodyIn = (sql: string, name: string): string | undefined => {
  const header = new RegExp(
    String.raw`CREATE OR REPLACE FUNCTION\s+"?public"?\."?${name}"?\s*\(`,
    'gi',
  );
  let body: string | undefined;
  for (const match of sql.matchAll(header)) {
    const rest = sql.slice(match.index);
    const tag = /AS\s+(\$\w*\$)/.exec(rest);
    if (!tag) continue;
    const start = tag.index + tag[0].length;
    body = rest.slice(start, rest.indexOf(tag[1], start));
  }
  return body;
};

/** The body the migrations leave in place: the last migration that defines the function. */
const deployedBody = (name: string) => {
  let body: string | undefined;
  for (const file of migrationNames) {
    body = bodyIn(read(`supabase/migrations/${file}`), name) ?? body;
  }
  return body ?? '';
};

/** Canonical files hold either the whole CREATE OR REPLACE or only the body. */
const canonicalBody = (name: string, path: string) => {
  const sql = read(`supabase/queries/${path}`);
  return bodyIn(sql, name) ?? sql;
};

const collapse = (sql: string) => sql.replace(/\s+/g, ' ');
const ORDER_LINK =
  /'\/profile\/orders\/' \|\| [\w.]+(?:::text)?( \|\| COALESCE\('\?shipment_id=' \|\| [\w.]+::text, ''\))?/g;

/** Every order link a body writes, and the shipment expression each one appends. */
const orderLinks = (body: string) =>
  [...collapse(body).matchAll(ORDER_LINK)].map((match) => match[0]);

// Producer, canonical file, and the expression that holds the notice's shipment.
const PRODUCERS: [string, string, string][] = [
  [
    'fn_notify_shipment_milestone',
    'shipments/fn_notify_shipment_milestone.sql',
    'p_shipment_id',
  ],
  [
    'fn_notify_label_deadline_reminders',
    'shipments/fn_notify_label_deadline_reminders.sql',
    'd.id',
  ],
  [
    'fn_mark_return_delivered',
    'return/fn_mark_return_delivered.sql',
    'v_shipment_id',
  ],
  ['fn_cancel_shipment', 'orders/fn_cancel_shipment.sql', 'p_shipment_id'],
  [
    'fn_apply_shipment_cancellation_refund_event',
    'orders/shipment_cancellation_refund_events.sql',
    'p_shipment_id',
  ],
  [
    'fn_seller_submit_return_evidence',
    'return/fn_seller_submit_return_evidence.sql',
    'v_shipment_id',
  ],
  [
    'fn_notify_dispute_opened',
    'disputes/fn_notify_dispute_opened.sql',
    'NEW.shipment_id',
  ],
  [
    'fn_cron_dispute_payout_timeout',
    'disputes/fn_cron_dispute_payout_timeout.sql',
    'v_dispute.shipment_id',
  ],
  [
    'fn_cron_dispute_shipping_timeout',
    'disputes/fn_cron_dispute_shipping_timeout.sql',
    'v_dispute.shipment_id',
  ],
  [
    'fn_cron_return_delivery_timeout',
    'disputes/fn_cron_return_delivery_timeout.sql',
    'v_dispute.shipment_id',
  ],
  [
    'fn_record_dispute_refund',
    'disputes/fn_record_dispute_refund.sql',
    'v_shipment_id',
  ],
  [
    'fn_resolve_dispute_to_buyer',
    'disputes/fn_resolve_dispute_to_buyer.sql',
    'v_shipment_id',
  ],
  [
    'fn_resolve_dispute_to_buyer_as_admin',
    'disputes/fn_resolve_dispute_to_buyer_as_admin.sql',
    'v_shipment_id',
  ],
  [
    'fn_resolve_dispute_to_seller',
    'disputes/fn_resolve_dispute_to_seller.sql',
    'v_shipment_id',
  ],
  [
    'fn_resolve_dispute_to_seller_as_admin',
    'disputes/fn_resolve_dispute_to_seller_as_admin.sql',
    'v_shipment_id',
  ],
];

const shipmentLink = (shipment: string) =>
  new RegExp(
    String.raw`^'/profile/orders/' \|\| [\w.]+(?:::text)? \|\| COALESCE\('\?shipment_id=' \|\| ${shipment.replace('.', String.raw`\.`)}::text, ''\)$`,
  );

describe('shipment notice links (SQL text)', () => {
  test.each(PRODUCERS)(
    '%s links every notice to its shipment, in the canonical file',
    (name, path, shipment) => {
      const links = orderLinks(canonicalBody(name, path));
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link).toMatch(shipmentLink(shipment));
    },
  );

  test.each(PRODUCERS)(
    '%s keeps the migrations in sync with its canonical file',
    (name, path) => {
      expect(collapse(deployedBody(name)).trim()).toBe(
        collapse(canonicalBody(name, path)).trim(),
      );
    },
  );
});
