import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for remove-legacy-wallet T4: the six core money, signup and
 * account functions no longer read or write the wallet tables, and the
 * canonical query files carry the same bodies. These tests read SQL text;
 * `supabase db reset` plus the Bruno requests prove the SQL runs.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_remove_wallet_writes_core.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_remove_wallet_writes_core.sql, found ${files.length}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
};

// fn_cancel_order was rewritten here and dropped later by *_drop_fn_cancel_order.sql: it has no
// canonical file left, so only the migration-body checks below still cover it.
const FUNCTIONS = [
  { name: 'fn_on_auth_user_created', args: '', file: 'triggers/auth/fn_on_auth_user_created.sql' },
  {
    name: 'fn_create_order_from_payment',
    args: 'uuid, text, numeric, numeric, uuid, uuid[]',
    file: 'orders/fn_create_order_from_payment.sql',
  },
  {
    name: 'fn_cancel_shipment',
    args: 'uuid, text, text, bigint',
    file: 'orders/fn_cancel_shipment.sql',
  },
  {
    name: 'fn_complete_shipment_refund',
    args: 'uuid',
    file: 'shipments/fn_complete_shipment_refund.sql',
  },
  { name: 'fn_close_account', args: 'uuid', file: 'auth/fn_close_account.sql' },
] as const;

const WALLET_REFERENCE = /\bwallets\b|wallet_transactions|payout_requests/i;

// Rewritten again by a later migration, whose test checks that the canonical file carries the
// newer body: *_connect_refund_requires_stripe.sql (fn_complete_shipment_refund).
const SUPERSEDED: ReadonlySet<string> = new Set(['fn_complete_shipment_refund']);

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

describe('remove legacy wallet writes from the core functions (SQL structural only)', () => {
  test('runs in one transaction', () => {
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
  });

  for (const fn of FUNCTIONS) {
    describe(fn.name, () => {
      test('the migration body does not reference the wallet tables', () => {
        expect(migrationBody(fn.name)).not.toMatch(WALLET_REFERENCE);
      });

      test('the canonical query file carries the migration body', () => {
        const canonical = canonicalBody(fn.file);
        expect(canonical).not.toMatch(WALLET_REFERENCE);
        if (SUPERSEDED.has(fn.name)) return;
        expect(collapse(canonical)).toBe(collapse(migrationBody(fn.name)));
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

describe('every other effect of the rewritten functions is kept', () => {
  test('signup still provisions the profile and the private profile', () => {
    const body = collapse(migrationBody('fn_on_auth_user_created'));
    expect(body).toContain('INSERT INTO public.profiles (');
    expect(body).toMatch(
      /INSERT INTO public\.profiles_private \(id, email, role, status\) VALUES \(NEW\.id, NEW\.email, 'user', 'active'\) ON CONFLICT \(id\) DO NOTHING/,
    );
    expect(body).toContain('FALLO CRÍTICO EN SETUP DE USUARIO');
  });

  test('order creation still builds the order, shipments, items, sales and notifications', () => {
    const body = collapse(migrationBody('fn_create_order_from_payment'));
    expect(body).toContain('ALREADY_PROCESSED');
    expect(body).toContain('ADDRESS_NOT_FOUND_OR_UNAUTHORIZED');
    expect(body).toContain('INSERT INTO public.orders');
    expect(body).toContain('INSERT INTO public.shipments');
    expect(body).toContain('INSERT INTO public.order_items');
    expect(body).toContain('net_payout');
    expect(body).toContain("UPDATE public.products SET status = 'SOLD'");
    expect(body).toContain("'¡Vendido!'");
    expect(body).toContain("'¡Compra Exitosa!'");
    expect(body).toContain('PRODUCT_NOT_AVAILABLE');
  });

  test('order cancellation still releases products and notifies both sides', () => {
    const body = collapse(migrationBody('fn_cancel_order'));
    expect(body).toContain('ORDER_NOT_FOUND');
    expect(body).toContain('ALREADY_CANCELLED');
    expect(body).toContain('CANNOT_CANCEL_IN_THIS_STATUS');
    expect(body).toMatch(/UPDATE public\.products SET status = 'VERIFIED', reserved_at = NULL/);
    expect(body).toContain("'Venta Cancelada'");
    expect(body).toContain("'Pedido Cancelado'");
    expect(body).toMatch(/UPDATE public\.orders SET status = 'cancelled'/);
    expect(body).toContain('INTERNAL_SERVER_ERROR');
  });

  test('shipment cancellation keeps the refund gate, loss reconciliation and notices', () => {
    const body = collapse(migrationBody('fn_cancel_shipment'));
    for (const code of [
      'SHIPMENT_NOT_FOUND',
      'ALREADY_CANCELLED',
      'CANNOT_CANCEL_IN_THIS_STATUS',
      'UNAUTHORIZED',
      'REFUND_NOT_SUCCEEDED',
      'ORDER_NOT_FOUND',
      'INTERNAL_SERVER_ERROR',
    ]) {
      expect(body).toContain(code);
    }
    expect(body).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(body).toContain('FROM public.shipment_cancellation_operations');
    expect(body).toMatch(/UPDATE public\.shipments SET status = 'cancelled'/);
    expect(body).toContain('cancellation_loss_cents = v_next_cancellation_loss_cents');
    expect(body).toContain("'shipment.cancelled'");
  });

  test('refund completion keeps the Connect skip, dispute resolution and notices', () => {
    const body = collapse(migrationBody('fn_complete_shipment_refund'));
    expect(body).toContain('SHIPMENT_NOT_FOUND');
    expect(body).toContain('CONNECT_SHIPMENT_SKIPPED_WALLET_REFUND');
    expect(body).toContain('stripe_payment_intent_id IS NOT NULL');
    expect(body).toContain('SHIPMENT_NOT_REFUNDABLE');
    expect(body).toContain("status = 'resolved', resolution_type = 'buyer'");
    expect(body).toContain("UPDATE public.shipments SET status = 'refunded'");
    expect(body).toContain("'Reembolso Finalizado'");
    expect(body).toContain("'Producto Reembolsado'");
    expect(body).not.toContain('WALLET_UPDATE_FAILED');
  });

  test('account closure keeps every Connect, order, shipment, dispute and refund blocker', () => {
    const body = collapse(migrationBody('fn_close_account'));
    for (const reason of [
      'account_restricted',
      'active_shipments',
      'active_orders',
      'open_disputes',
      'pending_payouts',
      'pending_refunds',
    ]) {
      expect(body).toContain(`'${reason}'`);
    }
    expect(body).toContain('public.admin_connect_payout_release_view');
    expect(body).toContain('public.connect_payout_runs');
    expect(body).toContain('public.shipment_cancellation_operations');
    expect(body).toContain('compensation_state');
    expect(body).toContain('INSERT INTO public.account_closures');
  });
});
