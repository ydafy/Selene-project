import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for the "product is purchasable now" buyer notice (T6/S9).
 * These tests read SQL text; `supabase db reset`, a rolled-back behavioral
 * check and the Bruno requests in bruno/products prove the SQL runs.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries', 'products');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_product_available_notification.sql'),
  );
  if (files.length !== 1) {
    throw new Error(`Expected exactly one *_product_available_notification.sql, found ${files.length}`);
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

const triggerStatement = (sql: string, name: string): string | undefined =>
  normalize(sql).match(new RegExp(`CREATE TRIGGER ${name}.*?;`, 'i'))?.[0];

const migration = findMigration();
const code = normalize(migration);

const files = {
  fn_notify_product_available: 'fn_notify_product_available.sql',
  fn_tr_product_available_on_verify: 'fn_tr_product_available_on_verify.sql',
  fn_tr_product_available_on_connect_complete: 'fn_tr_product_available_on_connect_complete.sql',
} as const;

// Must keep every kind already allowed remotely. All branches share one
// remote project: shipment.refund_failed comes from the unmerged
// shipment-cancellations branch (20261022005940), which runs before this
// migration, so dropping it here would break that producer.
const KINDS = [
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
];

describe('product.available event kind', () => {
  test('the catalogue keeps every remote kind and adds product.available', () => {
    expect(code).toContain('DROP CONSTRAINT notifications_event_kind_catalogue_chk');
    const list = code.match(
      /ADD CONSTRAINT notifications_event_kind_catalogue_chk CHECK ?\(event_kind IS NULL OR event_kind IN ?\((.*?)\) ?\)/i,
    )?.[1];
    expect(list).toBeDefined();
    const kinds = [...list!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(kinds).toEqual(KINDS);
  });
});

describe.each(Object.entries(files))('%s', (name, file) => {
  const canonical = readFileSync(join(QUERIES_DIR, file), 'utf8');

  test('the migration and the canonical file define the same function', () => {
    expect(definition(migration, name)).toBeDefined();
    expect(definition(migration, name)).toBe(definition(canonical, name));
  });

  test('is a definer function with a pinned search_path', () => {
    const def = definition(migration, name)!;
    expect(def).toMatch(/LANGUAGE plpgsql/i);
    expect(def).toMatch(/SECURITY DEFINER/);
    expect(def).toMatch(/SET search_path = public, pg_temp/);
  });
});

describe('fn_notify_product_available', () => {
  const def = definition(migration, 'fn_notify_product_available')!;

  test('has the helper signature', () => {
    expect(def).toMatch(/fn_notify_product_available\( ?p_product_ids UUID\[\] ?\) RETURNS void/i);
  });

  test('only notifies for listings purchasable now', () => {
    expect(def).toContain("p.status = 'VERIFIED'");
    expect(def).toContain('p.deleted_at IS NULL');
    expect(def).toContain('pp.stripe_account_id IS NOT NULL');
    expect(def).toContain("pp.stripe_onboarding_status = 'complete'");
    expect(def).toContain("pp.status IS DISTINCT FROM 'suspended'");
    expect(def).toContain("pp.status IS DISTINCT FROM 'banned'");
  });

  test('notifies favoriters, never the seller', () => {
    expect(def).toContain('f.user_id');
    expect(def).toContain('f.user_id <> p.seller_id');
  });

  test('writes one typed notice per buyer per listing and ignores repeats', () => {
    expect(def).toContain("'product.available'");
    expect(def).toContain("'product.available:' || p.id::text");
    expect(def).toContain("jsonb_build_object('product_id', p.id, 'recipient_role', 'buyer')");
    expect(def).toContain("'/product/' || p.id::text");
    expect(def).toContain("'success'");
    expect(def).toContain('ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING');
  });

  test('is callable only by the service role', () => {
    const sig = 'public.fn_notify_product_available(UUID[])';
    expect(code).toContain(`REVOKE EXECUTE ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated;`);
    expect(code).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
  });
});

describe('triggers', () => {
  test('the verify trigger fires only when a listing first reaches VERIFIED', () => {
    const def = definition(migration, 'fn_tr_product_available_on_verify')!;
    expect(def).toMatch(/RETURNS trigger/i);
    expect(def).toContain('PERFORM public.fn_notify_product_available(ARRAY[NEW.id]);');
    const trg = triggerStatement(migration, 'trg_product_available_on_verify')!;
    expect(trg).toContain('AFTER UPDATE OF status ON public.products FOR EACH ROW');
    expect(trg).toContain(
      "WHEN (OLD.status IN ('PENDING_VERIFICATION', 'IN_REVIEW') AND NEW.status = 'VERIFIED')",
    );
    expect(trg).toContain('EXECUTE FUNCTION public.fn_tr_product_available_on_verify()');
    const canonical = readFileSync(join(QUERIES_DIR, files.fn_tr_product_available_on_verify), 'utf8');
    expect(triggerStatement(canonical, 'trg_product_available_on_verify')).toBe(trg);
  });

  test('the Connect trigger fires only when onboarding first becomes complete', () => {
    const def = definition(migration, 'fn_tr_product_available_on_connect_complete')!;
    expect(def).toMatch(/RETURNS trigger/i);
    expect(def).toContain('fn_notify_product_available(');
    expect(def).toContain('seller_id = NEW.id');
    expect(def).toContain("status = 'VERIFIED'");
    expect(def).toContain('deleted_at IS NULL');
    const trg = triggerStatement(migration, 'trg_product_available_on_connect_complete')!;
    expect(trg).toContain(
      'AFTER UPDATE OF stripe_onboarding_status ON public.profiles_private FOR EACH ROW',
    );
    expect(trg).toContain(
      "WHEN (OLD.stripe_onboarding_status IS DISTINCT FROM 'complete' AND NEW.stripe_onboarding_status = 'complete')",
    );
    expect(trg).toContain('EXECUTE FUNCTION public.fn_tr_product_available_on_connect_complete()');
    const canonical = readFileSync(
      join(QUERIES_DIR, files.fn_tr_product_available_on_connect_complete),
      'utf8',
    );
    expect(triggerStatement(canonical, 'trg_product_available_on_connect_complete')).toBe(trg);
  });

  test.each(['fn_tr_product_available_on_verify', 'fn_tr_product_available_on_connect_complete'])(
    'revokes EXECUTE on %s from every API role',
    (name) => {
      expect(code).toContain(
        `REVOKE EXECUTE ON FUNCTION public.${name}() FROM PUBLIC, anon, authenticated;`,
      );
    },
  );
});
