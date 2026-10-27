import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * remove-legacy-wallet T5 (S4): each rewritten function must equal its previous
 * deployed definition minus the explicit wallet blocks, so nothing else moved.
 * The previous definition is read from the migration that last defined it, each
 * wallet block is removed (or replaced by the stated refusal) with the patterns
 * below, which must each match exactly once, comments and whitespace are
 * dropped, and the result must equal the new body. The header must keep
 * SECURITY DEFINER/INVOKER and search_path.
 * SQL text only; `supabase db reset` plus Bruno prove the SQL runs.
 */

const DIR = join(import.meta.dir, '..');
const read = (name: string) =>
  readFileSync(join(DIR, name), 'utf8').replace(/\r/g, '');

const newMigrationName = readdirSync(DIR).find((f) =>
  f.endsWith('_remove_wallet_writes_disputes.sql'),
);
if (!newMigrationName) throw new Error('remove_wallet_writes_disputes migration missing');
const newMigration = read(newMigrationName);

/** Header (before the first $$) and body (between the first two $$) of a function. */
const definition = (sql: string, name: string) => {
  const start = sql.search(
    new RegExp(`CREATE OR REPLACE FUNCTION\\s+"?public"?\\."?${name}"?\\(`, 'i'),
  );
  if (start < 0) throw new Error(`${name} not found`);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$', open + 2);
  return { header: sql.slice(start, open), body: sql.slice(open + 2, close) };
};

const normalize = (sql: string) =>
  sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();

const headerTraits = (header: string) => ({
  securityDefiner: /SECURITY\s+DEFINER/i.test(header),
  searchPath: (
    header.match(/SET\s+"?search_path"?\s*(?:=|TO)\s*([^\n]+)/i)?.[1] ?? 'MISSING'
  ).replace(/["'\s]/g, ''),
});

/** A pattern to find once, and the normalized text that replaces it ('' removes it). */
type Block = readonly [pattern: RegExp, replacement?: string];

const withoutWallet = (body: string, blocks: readonly Block[]) => {
  let text = normalize(body);
  for (const [pattern, replacement = ' '] of blocks) {
    const matches = text.match(new RegExp(pattern.source, 'gi')) ?? [];
    expect(matches.length).toBe(1);
    text = text.replace(new RegExp(pattern.source, 'i'), () => replacement);
  }
  return normalize(text);
};

const BASELINE = '20261020100000_remote_schema_baseline.sql';

const REFUSE_CONFIRM =
  "IF NOT v_is_connect THEN RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::text, NULL::text, false; RETURN; END IF;";

/** The dispute-to-seller payout section: a Connect NOTICE, or the wallet move plus ledger row. */
const DISPUTE_PAYOUT_SECTION =
  /IF v_shipment_id IS NOT NULL AND EXISTS \( SELECT 1 FROM public\.shipments WHERE id = v_shipment_id AND stripe_payment_intent_id IS NOT NULL \) THEN NULL; RAISE NOTICE [\s\S]*?'Resolución de disputa a favor del vendedor' \); END IF;/;

const DISPUTE_CASES = ['fn_resolve_dispute_to_seller', 'fn_resolve_dispute_to_seller_as_admin'].map(
  (name) => ({
    name,
    previous: BASELINE,
    blocks: [
      [/v_total_payout NUMERIC; v_new_balance NUMERIC; v_wallet_id UUID;/],
      [DISPUTE_PAYOUT_SECTION],
    ] as readonly Block[],
  }),
);

const CASES: readonly { name: string; previous: string; blocks: readonly Block[] }[] = [
  {
    // BL36: the wallet credit of non-Connect shipments becomes a stable refusal.
    name: 'fn_confirm_shipment_delivery',
    previous: BASELINE,
    blocks: [
      [/v_seller_id uuid;/],
      [/v_wallet_id uuid; v_wallet_balance numeric; v_net_payout numeric;/],
      [/s\.seller_id, /],
      [/v_seller_id, /],
      [
        /IF NOT v_is_connect THEN SELECT wallet\.id, wallet\.available_balance INTO [\s\S]*?WHERE item\.shipment_id = p_shipment_id; END IF;/,
        REFUSE_CONFIRM,
      ],
      [
        /IF NOT v_is_connect THEN UPDATE public\.wallets [\s\S]*? ELSE (INSERT INTO public\.system_logs[\s\S]*?\);) END IF;/,
        "INSERT INTO public.system_logs (level, message, metadata) VALUES ( 'INFO', 'Connect shipment completion skipped deprecated wallet release', jsonb_build_object( 'shipment_id', p_shipment_id, 'source', p_source, 'is_connect', true ) );",
      ],
    ],
  },
  {
    // The non-Connect steps 2-8 (checks, payout calculation, wallet release, completion) become a refusal.
    name: 'fn_release_shipment_funds',
    previous: BASELINE,
    blocks: [
      [
        /DECLARE v_order_id UUID; v_seller_id UUID; v_status public\.order_status_enum; v_delivered_at TIMESTAMPTZ; v_wallet_id UUID; v_wallet_balance NUMERIC; v_net_payout NUMERIC; BEGIN/,
        'BEGIN',
      ],
      [
        /SELECT order_id, seller_id, status, delivered_at INTO v_order_id, v_seller_id, v_status, v_delivered_at FROM public\.shipments WHERE id = p_shipment_id FOR UPDATE;/,
        'PERFORM 1 FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;',
      ],
      [
        /IF v_status != 'delivered' THEN [\s\S]*?RETURN QUERY SELECT true, NULL::TEXT;/,
        "RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::TEXT; RETURN;",
      ],
    ],
  },
  ...DISPUTE_CASES,
  {
    name: 'fn_log_return_payment',
    previous: BASELINE,
    blocks: [
      [/v_seller_id UUID; v_wallet_id UUID; v_order_id UUID; v_shipment_id UUID;/, 'v_locked_id UUID;'],
      [
        /SELECT seller_id, order_id, shipment_id INTO v_seller_id, v_order_id, v_shipment_id FROM/,
        'SELECT id INTO v_locked_id FROM',
      ],
      [/SELECT id INTO v_wallet_id FROM public\.wallets [\s\S]*?FROM public\.wallets WHERE id = v_wallet_id;/],
    ],
  },
  // Comment-only rewrites: these crons never touched the wallet tables.
  { name: 'fn_cron_dispute_payout_timeout', previous: BASELINE, blocks: [] },
  { name: 'fn_cron_dispute_shipping_timeout', previous: BASELINE, blocks: [] },
  { name: 'fn_cron_return_delivery_timeout', previous: BASELINE, blocks: [] },
];

describe('rewritten functions equal their previous definition minus the wallet blocks', () => {
  for (const fn of CASES) {
    test(fn.name, () => {
      const previous = definition(read(fn.previous), fn.name);
      const next = definition(newMigration, fn.name);

      expect(headerTraits(next.header)).toEqual(headerTraits(previous.header));
      expect(withoutWallet(previous.body, fn.blocks)).toBe(normalize(next.body));
    });
  }
});
