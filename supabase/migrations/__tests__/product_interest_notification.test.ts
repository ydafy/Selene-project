import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for the seller "your listing generates interest" notice
 * (T7/S7-S8). These tests read SQL text; `supabase db reset`, a rolled-back
 * behavioral check and the Bruno requests in bruno/products prove the SQL runs.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries', 'products');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_product_interest_notification.sql'),
  );
  if (files.length !== 1) {
    throw new Error(`Expected exactly one *_product_interest_notification.sql, found ${files.length}`);
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
  fn_notify_product_interest: 'fn_notify_product_interest.sql',
  fn_tr_product_interest_on_favorite: 'fn_tr_product_interest_on_favorite.sql',
} as const;

// Must keep every kind already allowed remotely. All branches share one
// remote project: dropping a kind here would break its producer.
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
  'product.interest',
];

describe('product.interest event kind', () => {
  test('the catalogue keeps every remote kind and adds product.interest', () => {
    expect(code).toContain('DROP CONSTRAINT notifications_event_kind_catalogue_chk');
    const list = code.match(
      /ADD CONSTRAINT notifications_event_kind_catalogue_chk CHECK ?\(event_kind IS NULL OR event_kind IN ?\((.*?)\) ?\)/i,
    )?.[1];
    expect(list).toBeDefined();
    const kinds = [...list!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(kinds).toEqual(KINDS);
  });

  test('the header explains the shared remote catalogue', () => {
    expect(migration).toMatch(/shared/i);
    expect(migration).toContain('shipment.refund_failed');
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

describe('fn_notify_product_interest', () => {
  const def = definition(migration, 'fn_notify_product_interest')!;

  test('has the helper signature', () => {
    expect(def).toMatch(
      /fn_notify_product_interest\( ?p_product_id UUID, p_favoriter_id UUID ?\) RETURNS void/i,
    );
  });

  test('only considers live listings and skips the seller as favoriter', () => {
    expect(def).toContain('deleted_at IS NULL');
    expect(def).toMatch(/seller_id = p_favoriter_id/);
  });

  test('notifies only for the three not-purchasable states', () => {
    expect(def).toContain("'PENDING_VERIFICATION'");
    expect(def).toContain("'IN_REVIEW'");
    expect(def).toContain("'VERIFIED'");
    expect(def).toContain('pp.stripe_account_id IS NOT NULL');
    expect(def).toContain("pp.stripe_onboarding_status = 'complete'");
    expect(def).toContain("pp.status IS DISTINCT FROM 'suspended'");
    expect(def).toContain("pp.status IS DISTINCT FROM 'banned'");
  });

  test('counts favorites excluding the seller and takes the highest crossed milestone', () => {
    expect(def).toContain('FROM public.favorites');
    expect(def).toMatch(/user_id <> v_product\.seller_id/);
    const order = ['>= 25 THEN 25', '>= 10 THEN 10', '>= 5 THEN 5', '>= 1 THEN 1'].map((s) =>
      def.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('writes one typed seller notice per milestone and ignores repeats', () => {
    expect(def).toContain("'product.interest'");
    expect(def).toContain("'product.interest:' || v_product.id::text || ':' || v_milestone::text");
    expect(def).toContain(
      "jsonb_build_object('product_id', v_product.id, 'recipient_role', 'seller', 'milestone', v_milestone)",
    );
    expect(def).toContain("'info'");
    expect(def).toContain('ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING');
  });

  test('carries the next action per state', () => {
    expect(def).toContain("'/verify/' || v_product.id::text");
    expect(def).toContain("'/profile/listings'");
    expect(def).toContain("'/sell/onboarding'");
    expect(def).toContain('Envía tus pruebas para empezar a venderlo.');
    expect(def).toContain('Lo estamos revisando; te avisaremos al terminar.');
    expect(def).toContain('Activa tus pagos para poder venderlo.');
  });

  test('never reveals the favoriter', () => {
    const insert = def.slice(def.indexOf('INSERT INTO'));
    expect(insert).not.toContain('p_favoriter_id');
    expect(insert).not.toMatch(/f\.user_id|favoriter/i);
  });

  test('is callable only by the service role', () => {
    const sig = 'public.fn_notify_product_interest(UUID, UUID)';
    expect(code).toContain(`REVOKE EXECUTE ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated;`);
    expect(code).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
  });
});

describe('favorites trigger', () => {
  test('fires after every favorite insert and passes the favoriter along', () => {
    const def = definition(migration, 'fn_tr_product_interest_on_favorite')!;
    expect(def).toMatch(/RETURNS trigger/i);
    expect(def).toContain('PERFORM public.fn_notify_product_interest(NEW.product_id, NEW.user_id);');
    const trg = triggerStatement(migration, 'trg_product_interest_on_favorite')!;
    expect(trg).toContain('AFTER INSERT ON public.favorites FOR EACH ROW');
    expect(trg).toContain('EXECUTE FUNCTION public.fn_tr_product_interest_on_favorite()');
    const canonical = readFileSync(join(QUERIES_DIR, files.fn_tr_product_interest_on_favorite), 'utf8');
    expect(triggerStatement(canonical, 'trg_product_interest_on_favorite')).toBe(trg);
  });

  test('never blocks the buyer favorite when the seller notice fails', () => {
    // The favorite is the buyer's own action; the seller notice is best effort.
    for (const sql of [
      migration,
      readFileSync(join(QUERIES_DIR, files.fn_tr_product_interest_on_favorite), 'utf8'),
    ]) {
      const def = definition(sql, 'fn_tr_product_interest_on_favorite')!;
      expect(def).toMatch(/EXCEPTION WHEN OTHERS THEN RAISE WARNING/i);
      expect(def).toMatch(/RETURN NULL; END; \$\$/i);
    }
  });

  test('revokes EXECUTE on the trigger function from every API role', () => {
    expect(code).toContain(
      'REVOKE EXECUTE ON FUNCTION public.fn_tr_product_interest_on_favorite() FROM PUBLIC, anon, authenticated;',
    );
  });
});
