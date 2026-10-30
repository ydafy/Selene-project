import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for the push receipt check and purge (expo-push-notifications T3/S3/S7).
 * These tests read SQL text; `supabase db reset` and the Bruno requests in
 * bruno/push prove the SQL runs and what each role can do.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries');

const findMigration = (name: string): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => new RegExp(String.raw`^\d+_${name}\.sql$`).test(f));
  if (files.length !== 1) {
    throw new Error(`Expected exactly one *_${name}.sql, found ${files.length}`);
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
};

const normalize = (sql: string): string =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const definition = (sql: string, name: string): string | undefined =>
  normalize(sql).match(
    new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.${name}\(.*?\$\$ ?;`, 'i'),
  )?.[0];

const rawDefinition = (sql: string, name: string): string | undefined =>
  sql
    .replace(/\r/g, '')
    .match(new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.${name}\(.*?\n\$\$;`, 's'))?.[0];

const migration = findMigration('push_receipts_and_purge');
const code = normalize(migration);

const FUNCTIONS = [
  ['fn_list_push_receipts_due', 'integer'],
  ['fn_record_push_receipts', 'jsonb'],
  ['fn_purge_push_deliveries', 'integer'],
] as const;

describe('receipt columns', () => {
  test('push_deliveries stores the receipt outcome', () => {
    expect(code).toContain('ALTER TABLE public.push_deliveries');
    expect(code).toContain("ADD COLUMN receipt_status text CHECK (receipt_status IN ('ok', 'error', 'missing'))");
    expect(code).toContain('ADD COLUMN receipt_error text');
    expect(code).toContain('ADD COLUMN receipt_checked_at timestamptz');
  });

  test('indexes the receipt scan and the purge scan', () => {
    expect(code).toContain(
      "CREATE INDEX push_deliveries_receipt_due_idx ON public.push_deliveries (sent_at) WHERE status = 'sent' AND receipt_status IS NULL;",
    );
    expect(code).toContain(
      "CREATE INDEX push_deliveries_purge_idx ON public.push_deliveries (updated_at) WHERE status IN ('sent', 'failed', 'skipped');",
    );
  });
});

describe('service-role RPCs', () => {
  for (const [name, args] of FUNCTIONS) {
    test(`${name} is a service-role-only definer with a pinned search_path`, () => {
      const def = definition(migration, name);
      expect(def).toBeDefined();
      expect(def).toContain('SECURITY DEFINER');
      expect(def).toContain('SET search_path = public, pg_temp');
      expect(def).toContain("auth.role() IS DISTINCT FROM 'service_role'");
      expect(code).toContain(`REVOKE EXECUTE ON FUNCTION public.${name}(${args}) FROM PUBLIC, anon, authenticated;`);
      expect(code).toContain(`GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO service_role;`);
      expect(code).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}[^;]*(anon|PUBLIC|authenticated)`));
    });
  }

  test('grant review is explained in the header', () => {
    expect(migration).toContain('Grant review');
  });
});

describe('fn_list_push_receipts_due', () => {
  const def = () => definition(migration, 'fn_list_push_receipts_due')!;

  test('bounds the batch to the Expo limit of 1000 receipt ids', () => {
    expect(def()).toContain('p_limit IS NULL OR p_limit < 1 OR p_limit > 1000');
    expect(def()).toContain('INVALID_PUSH_RECEIPT_LIMIT');
  });

  test('lists sent tickets 15 minutes after sending, as Expo recommends', () => {
    expect(def()).toContain("d.status = 'sent'");
    expect(def()).toContain('d.receipt_status IS NULL');
    expect(def()).toContain('d.expo_ticket_id IS NOT NULL');
    expect(def()).toContain("d.sent_at <= now() - interval '15 minutes'");
  });

  test('re-checks a missing receipt at most every 15 minutes, unchecked rows first', () => {
    expect(def()).toContain("d.receipt_checked_at IS NULL OR d.receipt_checked_at <= now() - interval '15 minutes'");
    expect(def()).toContain('ORDER BY d.receipt_checked_at NULLS FIRST, d.sent_at');
  });
});

describe('fn_record_push_receipts', () => {
  const def = () => definition(migration, 'fn_record_push_receipts')!;

  test('validates the whole batch before touching any row', () => {
    expect(def()).toContain('INVALID_PUSH_RECEIPTS');
    expect(def()).toContain("jsonb_typeof(p_receipts) IS DISTINCT FROM 'array'");
    expect(def()).toContain("v_item->>'receipt' NOT IN ('ok', 'error', 'missing')");
    expect(def()).toContain('token_dead requires receipt error');
  });

  test('records each receipt once, only on a sent row without one', () => {
    expect(def()).toContain("d.status = 'sent' AND d.receipt_status IS NULL");
    expect(def()).toContain('receipt_checked_at = now()');
  });

  test('marks a receipt missing only one hour after sending; before that it stays due', () => {
    expect(def()).toContain("WHEN d.sent_at <= now() - interval '1 hour' THEN 'missing'");
  });

  test('a dead device disables its token unless the token registered again after the send', () => {
    expect(def()).toContain('UPDATE public.push_tokens');
    expect(def()).toContain('disabled_at = now()');
    expect(def()).toContain('t.disabled_at IS NULL');
    expect(def()).toContain('t.updated_at <= v_sent_at');
  });
});

describe('fn_purge_push_deliveries', () => {
  const def = () => definition(migration, 'fn_purge_push_deliveries')!;

  test('deletes only finished rows older than 30 days, in bounded batches', () => {
    expect(def()).toContain('p_limit IS NULL OR p_limit < 1 OR p_limit > 10000');
    expect(def()).toContain('INVALID_PUSH_PURGE_LIMIT');
    expect(def()).toContain("d.status IN ('sent', 'failed', 'skipped')");
    expect(def()).toContain("d.updated_at < now() - interval '30 days'");
    expect(def()).toContain('FOR UPDATE SKIP LOCKED');
    expect(def()).toContain('DELETE FROM public.push_deliveries');
  });
});

describe('canonical SQL parity', () => {
  for (const [name] of FUNCTIONS) {
    test(`${name} canonical file matches the migration`, () => {
      const canonical = readFileSync(join(QUERIES_DIR, 'push', `${name}.sql`), 'utf8');
      expect(rawDefinition(canonical, name)).toBeDefined();
      expect(rawDefinition(canonical, name)).toBe(rawDefinition(migration, name));
    });
  }
});
