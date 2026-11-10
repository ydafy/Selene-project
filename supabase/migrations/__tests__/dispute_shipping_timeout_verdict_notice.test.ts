import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for the shipping-timeout verdict notices (expo-push-notifications T6c/S4).
 * These tests read SQL text; `supabase db reset`, the psql probes in the task log and
 * bruno/disputes prove the SQL runs and which rows each path writes.
 */

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter(
  (name) => name.endsWith('_dispute_shipping_timeout_verdict_notice.sql'),
);
const migration =
  migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const previous = read(
  'supabase/migrations/20261027041145_release_shipment_funds_guard.sql',
);
const collapse = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const withoutComments = (sql: string) => sql.replace(/--[^\n]*/g, '');
const SIGNATURE = 'fn_cron_dispute_shipping_timeout()';
const bodyOf = (sql: string) => {
  const start = sql.indexOf(
    'CREATE OR REPLACE FUNCTION public.fn_cron_dispute_shipping_timeout(',
  );
  const open = start === -1 ? -1 : sql.indexOf('$$', start);
  return open === -1 ? '' : sql.slice(open + 2, sql.indexOf('\n$$;', open));
};
const body = bodyOf(migration);
const withoutNotice = (sql: string) =>
  collapse(
    withoutComments(sql).replace(
      /INSERT INTO public\.notifications[\s\S]*?;\s*(?=ELSE)/,
      '',
    ),
  );

describe('dispute shipping timeout verdict notice migration (SQL text)', () => {
  test('is one migration after the refunded notification migration, in one transaction', () => {
    expect(migrations).toHaveLength(1);
    expect(
      migrations[0]! > '20261101030000_shipment_refunded_notification.sql',
    ).toBe(true);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd()).toEndWith('COMMIT;');
    expect(migration).toMatch(/Grant review/);
  });

  test('changes only the notification insert of the previous definition', () => {
    expect(body).not.toBe('');
    const before = bodyOf(previous);
    expect(before).not.toBe('');
    expect(withoutNotice(body)).toBe(withoutNotice(before));
    expect(body).toContain('INSERT INTO public.notifications');
    expect(body.match(/INSERT INTO public\.notifications/g)).toHaveLength(1);
  });

  test('keeps the security mode, search path and service-only grants', () => {
    const start = migration.indexOf(
      'CREATE OR REPLACE FUNCTION public.fn_cron_dispute_shipping_timeout(',
    );
    const header = collapse(
      migration.slice(start, migration.indexOf('$$', start)),
    );
    expect(header).toContain('RETURNS void');
    expect(header).toContain('SECURITY DEFINER');
    expect(header).toContain("SET search_path TO 'public'");
    expect(migration).toContain(
      `REVOKE ALL ON FUNCTION public.${SIGNATURE} FROM PUBLIC, anon, authenticated;`,
    );
    expect(migration).toContain(
      `GRANT EXECUTE ON FUNCTION public.${SIGNATURE} TO service_role;`,
    );
    expect(migration).not.toMatch(/TO (anon|authenticated|PUBLIC)/);
  });

  test('still resolves, then releases, then notifies', () => {
    const code = collapse(withoutComments(body));
    const resolve = code.indexOf("resolution_type = 'seller_wins_timeout'");
    const release = code.indexOf(
      'fn_release_shipment_funds(v_dispute.shipment_id)',
    );
    const refuse = code.indexOf("RAISE EXCEPTION USING ERRCODE = 'SR001'");
    const notify = code.indexOf('INSERT INTO public.notifications');
    expect(resolve).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(resolve);
    expect(refuse).toBeGreaterThan(release);
    expect(notify).toBeGreaterThan(refuse);
  });

  test('writes two typed dispute.verdict notices bound to the dispute, with the new seller copy', () => {
    const notice = collapse(
      body.slice(
        body.indexOf('INSERT INTO public.notifications'),
        body.indexOf('ELSE', body.indexOf('INSERT INTO public.notifications')),
      ),
    );
    expect(notice).toContain(
      'user_id, type, title, message, action_path, event_kind, source_event_key, event_payload',
    );
    expect(notice).toContain("'dispute.verdict'");
    expect(notice).toContain(
      "'dispute.verdict:' || v_dispute.id::text || ':shipping_timeout'",
    );
    expect(notice).toContain(
      "jsonb_build_object('dispute_id', v_dispute.id, 'order_id', v_dispute.order_id, 'recipient_role', recipients.recipient_role)",
    );
    expect(notice).toContain("'/profile/orders/' || v_dispute.order_id::text");
    expect(notice).toContain(
      "(v_dispute.seller_id, 'seller', 'success', 'Disputa Ganada', 'El comprador no envió el retorno a tiempo. El caso se cerró a tu favor.')",
    );
    expect(notice).toContain(
      "(v_dispute.buyer_id, 'buyer', 'error', 'Disputa Perdida', 'No enviaste el producto a tiempo. El caso ha sido cerrado.')",
    );
    expect(notice).not.toContain('fondos han sido liberados');
  });

  test('skips the seller row when seller and buyer are the same user, and is idempotent per key', () => {
    const notice = collapse(body);
    expect(notice).toContain(
      "WHERE recipients.recipient_role = 'buyer' OR v_dispute.seller_id IS DISTINCT FROM v_dispute.buyer_id",
    );
    expect(notice).toContain(
      'ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING',
    );
  });
});
