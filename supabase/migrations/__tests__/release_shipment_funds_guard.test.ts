import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * fn_release_shipment_funds completes a Connect shipment only when it is
 * delivered, has no active dispute and is past the 48-hour grace period, and
 * sets completed_at. fn_cron_dispute_shipping_timeout resolves its dispute
 * before calling it and rolls the resolution back when the release refuses.
 * These tests read SQL text; `supabase db reset` plus the Bruno requests in
 * bruno/disputes prove the SQL runs.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_release_shipment_funds_guard.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_release_shipment_funds_guard.sql, found ${files.length}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8').replace(/\r/g, '');
};

const migration = findMigration();

const collapse = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

const withoutComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

/** The text between the opening `$$` of a function and its closing `$$;`. */
const migrationBody = (name: string): string => {
  const start = migration.search(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`),
  );
  if (start < 0) throw new Error(`${name} is not defined in the migration`);
  const open = migration.indexOf('$$', start);
  const close = migration.indexOf('$$;', open + 2);
  return migration.slice(open + 2, close);
};

const migrationHeader = (name: string): string => {
  const start = migration.search(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`),
  );
  return collapse(migration.slice(start, migration.indexOf('$$', start)));
};

const canonicalBody = (file: string): string =>
  readFileSync(join(QUERIES_DIR, file), 'utf8')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => !line.startsWith('--'))
    .join('\n');

const FUNCTIONS = [
  {
    name: 'fn_release_shipment_funds',
    args: 'uuid',
    file: 'shipments/fn_release_shipment_funds.sql',
  },
  {
    name: 'fn_cron_dispute_shipping_timeout',
    args: '',
    file: 'disputes/fn_cron_dispute_shipping_timeout.sql',
  },
] as const;

describe('release_shipment_funds_guard migration (SQL structural only)', () => {
  test('runs in one transaction and documents the grant review', () => {
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
    expect(migration).toMatch(/Grant review/);
  });

  for (const fn of FUNCTIONS) {
    test(`${fn.name}: the canonical query file carries the migration body`, () => {
      expect(collapse(canonicalBody(fn.file))).toBe(
        collapse(migrationBody(fn.name)),
      );
    });

    test(`${fn.name}: execute is limited to service_role, restated explicitly`, () => {
      const target = `public.${fn.name}(${fn.args})`;
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION ${target} FROM PUBLIC, anon, authenticated;`,
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION ${target} TO service_role;`,
      );
    });
  }

  test('both functions keep their security mode and search_path', () => {
    const release = migrationHeader('fn_release_shipment_funds');
    expect(release).not.toContain('SECURITY DEFINER');
    expect(release).toContain("SET search_path TO 'public', 'pg_temp'");

    const cron = migrationHeader('fn_cron_dispute_shipping_timeout');
    expect(cron).toContain('SECURITY DEFINER');
    expect(cron).toContain("SET search_path TO 'public'");
  });
});

describe('fn_release_shipment_funds completes only a delivered, undisputed Connect shipment past the grace period', () => {
  const body = collapse(withoutComments(migrationBody('fn_release_shipment_funds')));
  const completion = body.indexOf("SET status = 'completed'");

  test('reads the shipment once, locked', () => {
    expect(body).toContain(
      'SELECT s.status, s.delivered_at, s.stripe_payment_intent_id IS NOT NULL INTO v_status, v_delivered_at, v_is_connect FROM public.shipments AS s WHERE s.id = p_shipment_id FOR UPDATE;',
    );
    expect(body.match(/FROM public\.shipments/g)).toHaveLength(1);
    expect(body.indexOf('FOR UPDATE')).toBeLessThan(body.indexOf('UPDATE public.shipments'));
    expect(body).not.toMatch(/INSERT INTO public\.(?!system_logs)/);
  });

  const refusals = [
    ['SHIPMENT_NOT_FOUND', 'IF NOT FOUND THEN'],
    ['SHIPMENT_NOT_CONNECT', 'IF NOT v_is_connect THEN'],
    ['SHIPMENT_NOT_DELIVERED', "IF v_status IS DISTINCT FROM 'delivered' THEN"],
    [
      'SHIPMENT_IN_ACTIVE_DISPUTE',
      "IF EXISTS ( SELECT 1 FROM public.disputes AS dispute WHERE dispute.shipment_id = p_shipment_id AND dispute.status NOT IN ('resolved', 'rejected') ) THEN",
    ],
    [
      'GRACE_PERIOD_ACTIVE',
      "IF v_delivered_at IS NULL OR NOT (v_delivered_at <= now() - interval '48 hours') THEN",
    ],
  ] as const;

  for (const [code, condition] of refusals) {
    test(`refuses with ${code} before the shipment changes`, () => {
      expect(body).toContain(
        `${condition} RETURN QUERY SELECT false, '${code}'::text; RETURN; END IF;`,
      );
      expect(body.indexOf(`'${code}'`)).toBeGreaterThan(-1);
      expect(body.indexOf(`'${code}'`)).toBeLessThan(completion);
    });
  }

  test('checks in order: found, Connect, delivered, dispute, grace period', () => {
    const order = refusals.map(([code]) => body.indexOf(`'${code}'`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('completes once, with completed_at and updated_at, and keeps its success result', () => {
    expect(body.match(/UPDATE public\.shipments/g)).toHaveLength(1);
    expect(body).toContain(
      "UPDATE public.shipments SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = p_shipment_id;",
    );
    expect(body).toContain(
      "RETURN QUERY SELECT true, 'CONNECT_SHIPMENT_SKIPPED_WALLET'::text;",
    );
  });

  test('keeps the failure log', () => {
    expect(body).toContain("'Fallo en fn_release_shipment_funds'");
    expect(body).toContain('RETURN QUERY SELECT false, SQLERRM;');
  });
});

describe('fn_cron_dispute_shipping_timeout resolves the dispute before the release and undoes it on refusal', () => {
  const body = collapse(withoutComments(migrationBody('fn_cron_dispute_shipping_timeout')));

  test('keeps its selection', () => {
    expect(body).toContain(
      "WHERE d.status = 'waiting_return' AND d.return_payout_status = 'paid' AND d.return_tracking_number IS NULL AND d.updated_at < (now() - interval '48 hours') FOR UPDATE SKIP LOCKED",
    );
  });

  test('resolves, then releases, then notifies', () => {
    const resolve = body.indexOf("resolution_type = 'seller_wins_timeout'");
    const release = body.indexOf('fn_release_shipment_funds(v_dispute.shipment_id)');
    const notify = body.indexOf('INSERT INTO public.notifications');
    expect(resolve).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(resolve);
    expect(notify).toBeGreaterThan(release);
  });

  test('a refused release raises so the resolution rolls back, and is logged as before', () => {
    expect(body).toContain(
      "IF v_success IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE = 'SR001', MESSAGE = 'RELEASE_REFUSED'; END IF;",
    );
    expect(body).toContain(
      "EXCEPTION WHEN SQLSTATE 'SR001' THEN INSERT INTO public.system_logs (level, message, metadata) VALUES ('WARNING', 'Cron shipping timeout: release failed', jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', v_err));",
    );
    expect(body.indexOf("WHEN SQLSTATE 'SR001'")).toBeLessThan(
      body.indexOf('WHEN OTHERS THEN'),
    );
  });

  test('keeps the notices, the missing-shipment log and the batch exception log', () => {
    expect(body).toContain("'Disputa Ganada'");
    expect(body).toContain("'Disputa Perdida'");
    expect(body).toContain(
      "'Cron shipping timeout: dispute without shipment_id — requires manual intervention'",
    );
    expect(body).toContain("'Cron shipping timeout: DB exception'");
  });
});
