import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * remove-legacy-wallet T4 (S4): each rewritten function must equal its previous
 * deployed definition minus the explicit wallet blocks, so nothing else moved.
 * The previous definition is read from the migration that last defined it, the
 * wallet blocks are removed with the regexes below (each must match exactly
 * once), comments and whitespace are dropped, and the result must equal the new
 * body. The header must keep SECURITY DEFINER/INVOKER and search_path.
 * SQL text only; `supabase db reset` plus Bruno prove the SQL runs.
 */

const DIR = join(import.meta.dir, '..');
const read = (name: string) =>
  readFileSync(join(DIR, name), 'utf8').replace(/\r/g, '');

const newMigrationName = readdirSync(DIR).find((f) =>
  f.endsWith('_remove_wallet_writes_core.sql'),
);
if (!newMigrationName) throw new Error('remove_wallet_writes_core migration missing');
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

/** Removes each wallet block, asserting it existed exactly once. */
const withoutWallet = (body: string, blocks: RegExp[]) => {
  let text = normalize(body);
  for (const block of blocks) {
    const matches = text.match(new RegExp(block.source, 'gi')) ?? [];
    expect(matches.length).toBe(1);
    text = text.replace(new RegExp(block.source, 'i'), ' ');
  }
  return normalize(text);
};

const CASES = [
  {
    name: 'fn_on_auth_user_created',
    previous: '20261022001509_auth_username_provisioning.sql',
    blocks: [
      /INSERT INTO public\.wallets \(user_id, available_balance, pending_balance\) VALUES \(NEW\.id, 0, 0\) ON CONFLICT \(user_id\) DO NOTHING;/,
    ],
  },
  {
    name: 'fn_create_order_from_payment',
    previous: '20261020100000_remote_schema_baseline.sql',
    blocks: [
      /v_wallet_id UUID;/,
      /v_wallet_pending NUMERIC;/,
      /v_wallet_available NUMERIC;/,
      /SELECT id, pending_balance, available_balance INTO v_wallet_id, v_wallet_pending, v_wallet_available FROM public\.wallets WHERE user_id = v_prod\.seller_id FOR UPDATE; UPDATE public\.wallets SET [^;]*; INSERT INTO public\.wallet_transactions \([^)]*\) VALUES \([^;]*;/,
    ],
  },
  {
    name: 'fn_cancel_order',
    previous: '20261020100000_remote_schema_baseline.sql',
    blocks: [
      /v_wallet_record RECORD;/,
      /oi\.net_payout,/,
      /SELECT id, pending_balance INTO v_wallet_record [\s\S]*?END IF;/,
    ],
  },
  {
    name: 'fn_cancel_shipment',
    previous: '20261022013846_shipment_cancellation_refund_resolution.sql',
    blocks: [
      /v_wallet_id UUID;/,
      /v_wallet_pending NUMERIC;/,
      /v_wallet_available NUMERIC;/,
      /v_total_refund NUMERIC;/,
      /SELECT COALESCE\(SUM\(COALESCE\(net_payout, 0\)\), 0\) INTO v_total_refund [\s\S]*?END IF;/,
    ],
  },
  {
    name: 'fn_complete_shipment_refund',
    previous: '20261020100000_remote_schema_baseline.sql',
    blocks: [
      /v_net_payout NUMERIC;/,
      /v_wallet_id UUID;/,
      /v_wallet_available NUMERIC;/,
      /SELECT COALESCE\(SUM\(net_payout\), 0\) INTO v_net_payout [\s\S]*?INSERT INTO public\.wallet_transactions [\s\S]*?\);/,
    ],
  },
  {
    name: 'fn_close_account',
    previous: '20261023043220_account_closure.sql',
    blocks: [
      /OR EXISTS \( SELECT 1 FROM public\.wallets w WHERE w\.user_id = p_user_id AND \(w\.available_balance > 0 OR w\.pending_balance > 0\) \) OR EXISTS \( SELECT 1 FROM public\.payout_requests pr WHERE pr\.user_id = p_user_id AND pr\.status IN \('pending', 'processing'\) \)/,
    ],
  },
] as const;

describe('rewritten functions equal their previous definition minus the wallet blocks', () => {
  for (const fn of CASES) {
    test(fn.name, () => {
      const previous = definition(read(fn.previous), fn.name);
      const next = definition(newMigration, fn.name);

      expect(headerTraits(next.header)).toEqual(headerTraits(previous.header));
      expect(withoutWallet(previous.body, [...fn.blocks])).toBe(normalize(next.body));
    });
  }
});
