import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for remove-legacy-wallet T5: the delivery, release, dispute and
 * cron functions no longer read or write the wallet tables, and the canonical
 * query files carry the same bodies. These tests read SQL text; `supabase db
 * reset` plus the Bruno requests prove the SQL runs.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_remove_wallet_writes_disputes.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_remove_wallet_writes_disputes.sql, found ${files.length}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
};

const FUNCTIONS = [
  {
    name: 'fn_confirm_shipment_delivery',
    args: 'uuid, text, uuid, text',
    file: 'orders/fn_confirm_shipment_delivery.sql',
  },
  {
    name: 'fn_release_shipment_funds',
    args: 'uuid',
    file: 'shipments/fn_release_shipment_funds.sql',
  },
  {
    name: 'fn_resolve_dispute_to_seller',
    args: 'uuid, text',
    file: 'disputes/fn_resolve_dispute_to_seller.sql',
  },
  {
    name: 'fn_resolve_dispute_to_seller_as_admin',
    args: 'uuid, text, uuid',
    file: 'disputes/fn_resolve_dispute_to_seller_as_admin.sql',
  },
  {
    name: 'fn_log_return_payment',
    args: 'uuid, text, numeric',
    file: 'disputes/fn_log_return_payment.sql',
  },
  {
    name: 'fn_cron_dispute_payout_timeout',
    args: '',
    file: 'disputes/fn_cron_dispute_payout_timeout.sql',
  },
  {
    name: 'fn_cron_dispute_shipping_timeout',
    args: '',
    file: 'disputes/fn_cron_dispute_shipping_timeout.sql',
  },
  {
    name: 'fn_cron_return_delivery_timeout',
    args: '',
    file: 'disputes/fn_cron_return_delivery_timeout.sql',
  },
] as const;

const WALLET_REFERENCE = /\bwallets\b|wallet_transactions|payout_requests/i;

const collapse = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

const migration = findMigration();

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

/**
 * The canonical file follows the newest migration that defines the function, so a later
 * migration that changes one of these functions (B5.8 changed fn_confirm_shipment_delivery; the release-funds guard changed fn_release_shipment_funds and fn_cron_dispute_shipping_timeout)
 * does not make this migration's body the reference.
 */
const latestBody = (name: string): string => {
  const pattern = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`);
  const newest = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => pattern.test(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')))
    .pop();
  const sql = readFileSync(join(MIGRATIONS_DIR, newest as string), 'utf8');
  const start = sql.search(pattern);
  const open = sql.indexOf('$$', start);
  return sql.slice(open + 2, sql.indexOf('$$;', open + 2));
};

/** Canonical files are either a full CREATE statement or a bare body. */
const canonicalBody = (file: string): string => {
  const sql = readFileSync(join(QUERIES_DIR, file), 'utf8');
  if (sql.includes('$$')) {
    const open = sql.indexOf('$$');
    return sql.slice(open + 2, sql.indexOf('$$;', open + 2));
  }
  return sql
    .split('\n')
    .filter((line) => !line.startsWith('--'))
    .join('\n');
};

describe('remove legacy wallet writes from the delivery, release, dispute and cron functions (SQL structural only)', () => {
  test('runs in one transaction', () => {
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
  });

  for (const fn of FUNCTIONS) {
    describe(fn.name, () => {
      test('the migration body does not reference the wallet', () => {
        const body = migrationBody(fn.name);
        expect(body).not.toMatch(WALLET_REFERENCE);
        // Two deployed strings keep the word: the Connect completion log row of
        // fn_confirm_shipment_delivery and the CONNECT_SHIPMENT_SKIPPED_WALLET
        // result of fn_release_shipment_funds. Nothing else may mention it.
        const mentions = body.match(/wallet/gi) ?? [];
        expect(mentions).toHaveLength(
          fn.name === 'fn_confirm_shipment_delivery' ||
            fn.name === 'fn_release_shipment_funds'
            ? 1
            : 0,
        );
        expect(body).not.toContain('payout_requests');
      });

      test('the canonical query file carries the migration body', () => {
        const canonical = canonicalBody(fn.file);
        expect(canonical).not.toMatch(WALLET_REFERENCE);
        expect(collapse(canonical)).toBe(collapse(latestBody(fn.name)));
      });

      test('execute is limited to service_role, restated explicitly', () => {
        const target = `public.${fn.name}(${fn.args})`;
        expect(migration).toContain(
          `REVOKE ALL ON FUNCTION ${target} FROM PUBLIC, anon, authenticated;`,
        );
        expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${target} TO service_role;`);
      });
    });
  }

  test('the grant review is documented in the migration', () => {
    expect(migration).toMatch(/Grant review/);
  });
});

describe('the non-Connect branch is refused instead of crediting a wallet (BL36)', () => {
  test('fn_confirm_shipment_delivery refuses before it writes the completion event', () => {
    const body = collapse(migrationBody('fn_confirm_shipment_delivery'));
    expect(body).not.toContain('SELLER_WALLET_NOT_FOUND');
    expect(body).toContain(
      "IF NOT v_is_connect THEN RETURN QUERY SELECT false, 'SHIPMENT_NOT_CONNECT'::text, NULL::text, false; RETURN; END IF;",
    );
    expect(body.indexOf('SHIPMENT_NOT_CONNECT')).toBeLessThan(
      body.indexOf('INSERT INTO public.shipment_completion_events'),
    );
    expect(body.indexOf('SHIPMENT_NOT_CONNECT')).toBeGreaterThan(
      body.indexOf('AUTO_COMPLETION_NOT_DUE'),
    );
  });

  test('fn_release_shipment_funds refuses instead of completing without a payout', () => {
    const body = collapse(migrationBody('fn_release_shipment_funds'));
    expect(body).toContain("'SHIPMENT_NOT_CONNECT'");
    expect(body).not.toContain('SELLER_WALLET_NOT_FOUND');
    expect(body).not.toContain('WALLET_UPDATE_FAILED');
  });
});

describe('every other effect of the rewritten functions is kept', () => {
  test('delivery confirmation keeps the Connect path and its guards', () => {
    const body = collapse(migrationBody('fn_confirm_shipment_delivery'));
    for (const code of [
      'SERVICE_ROLE_REQUIRED',
      'INVALID_COMPLETION_SOURCE',
      'IDEMPOTENCY_KEY_REQUIRED',
      'INVALID_IDEMPOTENCY_KEY',
      'SHIPMENT_NOT_FOUND',
      'COMPLETION_AUDIT_MISSING',
      'SHIPMENT_NOT_IN_CONFIRMABLE_STATE',
      'SHIPMENT_HAS_ACTIVE_DISPUTE',
      'BUYER_REQUIRED',
      'AUTO_COMPLETION_NOT_DUE',
      'INTERNAL_ERROR',
    ]) {
      expect(body).toContain(code);
    }
    expect(body).toContain('INSERT INTO public.shipment_completion_events');
    expect(body).toContain("SET status = 'completed', completed_at = v_completed_at");
    expect(body).toContain('buyer_confirmed_at = CASE WHEN p_source');
    expect(body).toContain('Connect shipment completion');
  });

  test('release keeps the not-found check, the Connect guard and the failure log', () => {
    const body = collapse(migrationBody('fn_release_shipment_funds'));
    for (const code of ['SHIPMENT_NOT_FOUND', 'CONNECT_SHIPMENT_SKIPPED_WALLET']) {
      expect(body).toContain(code);
    }
    // The non-Connect checks (delivery, dispute, grace period) only guarded the wallet release.
    for (const code of ['SHIPMENT_NOT_DELIVERED', 'SHIPMENT_IN_ACTIVE_DISPUTE', 'GRACE_PERIOD_ACTIVE']) {
      expect(body).not.toContain(code);
    }
    expect(body).toContain('stripe_payment_intent_id IS NOT NULL');
    expect(body).toContain("UPDATE public.shipments SET status = 'completed' WHERE id = p_shipment_id");
    expect(body).toContain("'Fallo en fn_release_shipment_funds'");
  });

  for (const name of [
    'fn_resolve_dispute_to_seller',
    'fn_resolve_dispute_to_seller_as_admin',
  ]) {
    test(`${name} keeps the verdict, shipment completion, audit and notices`, () => {
      const body = collapse(migrationBody(name));
      expect(body).toContain('UNAUTHORIZED_ADMIN_ONLY');
      expect(body).toContain('DISPUTE_NOT_FOUND');
      expect(body).toContain('INVALID_DISPUTE_STATUS');
      expect(body).toContain("status = 'resolved', resolution_type = 'seller'");
      expect(body).toContain("UPDATE public.shipments SET status = 'completed'");
      expect(body).toContain("UPDATE public.orders SET status = 'completed'");
      expect(body).toContain("'DISPUTE_RESOLVE_SELLER'");
      expect(body).toContain("'dispute.verdict'");
      expect(body).toContain('INTERNAL_SERVER_ERROR');
    });
  }

  test('return payment logging still marks the dispute paid and return_shipped', () => {
    const body = collapse(migrationBody('fn_log_return_payment'));
    expect(body).toContain('DISPUTE_NOT_FOUND');
    expect(body).toContain('FOR UPDATE');
    expect(body).toContain(
      "SET return_payout_id = p_stripe_id, return_payout_status = 'paid', status = 'return_shipped'",
    );
  });

  test('the cron functions keep their selection, refund and notification logic', () => {
    const payout = collapse(migrationBody('fn_cron_dispute_payout_timeout'));
    expect(payout).toContain("d.status = 'waiting_return' AND d.return_payout_status = 'pending'");
    expect(payout).toContain('fn_complete_shipment_refund(v_dispute.shipment_id)');
    expect(payout).toContain("'Disputa Ganada'");

    const shipping = collapse(migrationBody('fn_cron_dispute_shipping_timeout'));
    expect(shipping).toContain('fn_release_shipment_funds(v_dispute.shipment_id)');
    expect(shipping).toContain("resolution_type = 'seller_wins_timeout'");

    const returned = collapse(migrationBody('fn_cron_return_delivery_timeout'));
    expect(returned).toContain("d.status = 'return_delivered'");
    expect(returned).toContain('fn_complete_shipment_refund(v_dispute.shipment_id)');
    expect(returned).toContain('RETURN QUERY SELECT v_processed, v_errors');
  });
});
