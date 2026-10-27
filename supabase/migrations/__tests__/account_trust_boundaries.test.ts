import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Source-contract guards for account trust boundaries (auth-hardening T1c, D1/D2/D4/D5/D6).
 * Static checks only: they do not prove PostgreSQL behavior or remote deployment.
 */

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => {
  const absolute = join(root, path);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n') : '';
};
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const migration = read('supabase/migrations/archive/20261018130000_account_trust_boundaries.sql');
const helperSource = read('supabase/queries/auth/fn_current_account_is_active.sql');
const reserveSource = read('supabase/queries/products/fn_reserve_products.sql');

const functionBlock = (sql: string, name: string) =>
  sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`));
const policyBlock = (name: string) =>
  normalize(migration.match(new RegExp(`CREATE POLICY ${name} ON public\\.products[\\s\\S]*?;`))?.[0] ?? '');

const helperBlock = functionBlock(migration, 'fn_current_account_is_active');
const reserveBlock = functionBlock(migration, 'fn_reserve_products');
const payoutBlock = functionBlock(migration, 'fn_request_payout');
const helperBody = helperBlock?.[1] ?? '';
const reserveBody = reserveBlock?.[1] ?? '';
const payoutBody = payoutBlock?.[1] ?? '';
const reserveCanonicalBody = functionBlock(reserveSource, 'fn_reserve_products')?.[1] ?? '';

const ACTIVE = '(SELECT public.fn_current_account_is_active())';

describe('account trust boundaries migration', () => {
  test('is a single forward-only transaction with lock and statement timeouts', () => {
    expect(migration).toMatch(/^(--.*\n)+BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '60s';\n/);
    expect(migration.trimEnd()).toEndWith('COMMIT;');
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration).not.toMatch(/DROP FUNCTION|DROP TABLE|ALTER TABLE/i);
  });

  test('guards the T1b dependency and both deployed RPC signatures before any change', () => {
    const guard = migration.indexOf('EXPECTED_ACCOUNT_HOLD_COLUMN_MISSING');
    expect(migration).toMatch(
      /attrelid = 'public\.products'::regclass\s+AND attname = 'status_before_account_hold'\s+AND NOT attisdropped/,
    );
    expect(migration).toContain("to_regprocedure('public.fn_reserve_products(uuid,uuid[])') IS NULL");
    expect(migration).toContain("to_regprocedure('public.fn_request_payout(numeric,uuid)') IS NULL");
    expect(migration).toContain("RAISE EXCEPTION 'EXPECTED_DEPLOYED_RESERVE_RPC_MISSING'");
    expect(migration).toContain("RAISE EXCEPTION 'EXPECTED_DEPLOYED_PAYOUT_RPC_MISSING'");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(migration.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(guard).toBeLessThan(migration.indexOf('DROP POLICY'));
  });

  test('asserts exactly one overload of each replaced or created function', () => {
    const tail = migration.slice(migration.lastIndexOf('CREATE OR REPLACE FUNCTION'));
    expect(tail).toMatch(
      /p\.proname = ANY \(ARRAY\['fn_current_account_is_active', 'fn_reserve_products', 'fn_request_payout'\]\)/,
    );
    expect(tail).toMatch(/HAVING count\(\*\) <> 1/);
    expect(tail).toContain("RAISE EXCEPTION 'UNEXPECTED_TRUST_BOUNDARY_RPC_OVERLOADS'");
  });

  test('leaves the ACLs of the replaced RPCs unchanged', () => {
    expect(migration).not.toMatch(/(GRANT|REVOKE) EXECUTE ON FUNCTION public\.fn_reserve_products/i);
    expect(migration).not.toMatch(/(GRANT|REVOKE) EXECUTE ON FUNCTION public\.fn_request_payout/i);
  });

  test('migration bodies equal the canonical query copies', () => {
    expect(helperSource).not.toBe('');
    expect(reserveCanonicalBody).not.toBe('');
    expect(normalize(helperBody)).toBe(normalize(helperSource));
    expect(normalize(reserveBody)).toBe(normalize(reserveCanonicalBody));
  });
});

describe('fn_current_account_is_active helper', () => {
  test('is a parameterless STABLE SECURITY DEFINER function with a pinned search_path', () => {
    expect(helperBlock?.[0]).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_current_account_is_active()\nRETURNS BOOLEAN\nLANGUAGE sql\nSTABLE\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $$',
    );
  });

  test('treats only suspended or banned callers as inactive', () => {
    expect(normalize(helperBody)).toBe(
      "SELECT NOT EXISTS ( SELECT 1 FROM public.profiles_private WHERE id = (SELECT auth.uid()) AND status IN ('suspended', 'banned') );",
    );
  });

  test('is executable by authenticated and service_role only', () => {
    expect(migration).toContain(
      'REVOKE EXECUTE ON FUNCTION public.fn_current_account_is_active() FROM PUBLIC, anon;',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_current_account_is_active() TO authenticated, service_role;',
    );
    expect(migration.indexOf('REVOKE EXECUTE ON FUNCTION public.fn_current_account_is_active()')).toBeLessThan(
      migration.indexOf('GRANT EXECUTE ON FUNCTION public.fn_current_account_is_active()'),
    );
    expect(migration.indexOf('GRANT EXECUTE ON FUNCTION public.fn_current_account_is_active()')).toBeLessThan(
      migration.indexOf('CREATE POLICY'),
    );
  });
});

describe('products client policies (D1/D2)', () => {
  test('recreates both policies idempotently for authenticated only', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS products_insert ON public.products;');
    expect(migration).toContain('DROP POLICY IF EXISTS products_update_owner ON public.products;');
    expect(policyBlock('products_insert')).toContain('FOR INSERT TO authenticated WITH CHECK (');
    expect(policyBlock('products_update_owner')).toContain('FOR UPDATE TO authenticated USING (');
    expect(migration).not.toMatch(/POLICY (IF EXISTS )?products_(select|update_admin|delete)/);
  });

  test('insert only allows an active owner to create a fresh pending listing', () => {
    expect(policyBlock('products_insert')).toBe(
      normalize(`CREATE POLICY products_insert ON public.products
        FOR INSERT TO authenticated
        WITH CHECK (
          (SELECT auth.uid()) = seller_id
          AND status = 'PENDING_VERIFICATION'::public.product_status_enum
          AND verified_at IS NULL
          AND deleted_at IS NULL
          AND reserved_at IS NULL
          AND locked_by IS NULL
          AND status_before_account_hold IS NULL
          AND ${ACTIVE}
        );`),
    );
  });

  test('owner update keeps deployed semantics, requires an active account and forbids the hold column', () => {
    expect(policyBlock('products_update_owner')).toBe(
      normalize(`CREATE POLICY products_update_owner ON public.products
        FOR UPDATE TO authenticated
        USING (
          seller_id = (SELECT auth.uid())
          AND deleted_at IS NULL
          AND status = ANY (ARRAY['PENDING_VERIFICATION', 'VERIFIED', 'HIDDEN', 'REJECTED']::public.product_status_enum[])
          AND ${ACTIVE}
        )
        WITH CHECK (
          seller_id = (SELECT auth.uid())
          AND status = ANY (ARRAY['PENDING_VERIFICATION', 'HIDDEN', 'IN_REVIEW']::public.product_status_enum[])
          AND status_before_account_hold IS NULL
          AND ${ACTIVE}
        );`),
    );
  });
});

describe('profiles client writes (D4)', () => {
  test('revokes table-wide UPDATE and re-grants only user-editable columns', () => {
    const revoke = migration.indexOf('REVOKE UPDATE ON public.profiles FROM anon, authenticated;');
    const grant = migration.indexOf('GRANT UPDATE (username, avatar_url, updated_at) ON public.profiles TO authenticated;');
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(migration).not.toMatch(/(GRANT|REVOKE) (SELECT|INSERT|DELETE|ALL)[^;]*ON (TABLE )?public\.profiles\b/i);
    expect(migration).not.toMatch(/POLICY[^;]*ON public\.profiles\b/);
  });
});

describe('fn_reserve_products (D5)', () => {
  test('keeps the deployed signature and security attributes', () => {
    expect(reserveBlock?.[0]).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_reserve_products(\n  p_buyer_id UUID,\n  p_product_ids UUID[]\n)\nRETURNS TABLE(total_price NUMERIC, success BOOLEAN, error_message TEXT)\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $$',
    );
    expect(reserveSource).toContain(reserveBlock?.[0].split('\n').slice(0, 8).join('\n') ?? 'missing');
  });

  describe.each([
    ['migration body', () => reserveBody],
    ['canonical copy', () => reserveCanonicalBody],
  ])('%s', (_label, body) => {
    test('rejects a banned buyer after the empty-cart guard and before any write', () => {
      const sql = body();
      expect(sql).toMatch(
        /IF EXISTS \(\s+SELECT 1 FROM public\.profiles_private pp\s+WHERE pp\.id = p_buyer_id AND pp\.status = 'banned'\s+\) THEN\s+RETURN QUERY SELECT 0::NUMERIC, false, 'ACCOUNT_RESTRICTED'::TEXT;\s+RETURN;\s+END IF;/,
      );
      expect(sql.indexOf('EMPTY_CART')).toBeLessThan(sql.indexOf('ACCOUNT_RESTRICTED'));
      expect(sql.indexOf('ACCOUNT_RESTRICTED')).toBeLessThan(sql.indexOf('UPDATE public.products'));
      expect(sql).not.toMatch(/p_buyer_id AND pp\.status IN/);
    });

    test('reserves only products whose seller is not suspended or banned', () => {
      expect(body()).toMatch(
        /WITH reserved AS \(\s+UPDATE public\.products\s+SET status = 'RESERVED',\s+updated_at = now\(\),\s+reserved_at = now\(\)\s+WHERE id = ANY\(p_product_ids\)\s+AND status = 'VERIFIED'\s+AND seller_id <> p_buyer_id\s+AND NOT EXISTS \(\s+SELECT 1 FROM public\.profiles_private pp\s+WHERE pp\.id = products\.seller_id\s+AND pp\.status IN \('suspended', 'banned'\)\s+\)\s+RETURNING id, price\s+\)/,
      );
    });

    test('keeps stale release, row lock and the all-or-nothing contract', () => {
      const sql = body();
      expect(sql).toMatch(/AND status = 'RESERVED'\s+AND reserved_at < now\(\) - interval '10 minutes';/);
      expect(sql).toMatch(/PERFORM 1\s+FROM public\.products\s+WHERE id = ANY\(p_product_ids\)\s+ORDER BY id\s+FOR UPDATE;/);
      expect(sql).toMatch(/IF v_count = cardinality\(p_product_ids\) THEN\s+RETURN QUERY SELECT v_sum, true, NULL::TEXT;/);
      expect(sql).toMatch(/WHERE id = ANY\(v_reserved_ids\)\s+AND status = 'RESERVED';/);
      expect(sql).toContain("RETURN QUERY SELECT 0::NUMERIC, false, 'SOME_PRODUCTS_UNAVAILABLE'::TEXT;");
    });
  });
});

describe('fn_request_payout (D6)', () => {
  test('keeps the deployed signature, SECURITY DEFINER and empty search_path', () => {
    expect(payoutBlock?.[0]).toContain(
      "CREATE OR REPLACE FUNCTION public.fn_request_payout(\n  p_amount NUMERIC,\n  p_bank_account_id UUID\n)\nRETURNS TABLE(success BOOLEAN, error_message TEXT)\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = ''\nAS $$",
    );
  });

  describe.each([
    ['migration body', () => payoutBody],
  ])('%s', (_label, body) => {
    test('keeps the Connect guard first, then the JWT actor, then the account gate', () => {
      const sql = body();
      const connect = sql.indexOf('CONNECT_PAYOUTS_MANAGED_BY_STRIPE');
      const jwt = sql.indexOf("'UNAUTHORIZED'");
      const gate = sql.indexOf('ACCOUNT_RESTRICTED');
      expect(connect).toBeGreaterThan(-1);
      expect(connect).toBeLessThan(jwt);
      expect(jwt).toBeLessThan(gate);
      expect(gate).toBeLessThan(sql.indexOf('min_payout_amount_cents'));
      expect(gate).toBeLessThan(sql.indexOf('public.seller_bank_accounts'));
      expect(gate).toBeLessThan(sql.indexOf('public.wallets'));
      expect(sql).toMatch(
        /IF EXISTS \(\s+SELECT 1 FROM public\.profiles_private\s+WHERE id = v_auth_user_id AND status IN \('suspended', 'banned'\)\s+\) THEN\s+RETURN QUERY SELECT false, 'ACCOUNT_RESTRICTED'::TEXT; RETURN;\s+END IF;/,
      );
    });

    test('keeps schema-qualified writes, wallet lock and error logging', () => {
      const sql = body();
      expect(sql).toContain("v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;");
      expect(sql).toMatch(/FROM public\.wallets\s+WHERE user_id = v_auth_user_id\s+FOR UPDATE;/);
      expect(sql).toContain('INSERT INTO public.payout_requests');
      expect(sql).toContain('INSERT INTO public.wallet_transactions');
      expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]*INSERT INTO public\.system_logs[\s\S]*'INTERNAL_SERVER_ERROR'::TEXT;\s*END;\s*$/);
      expect(sql).not.toMatch(/FROM (profiles_private|wallets|system_settings)\b/);
    });

    test('preserves the deployed user-facing and log literals (no drift from the live body)', () => {
      const sql = body();
      expect(sql).toContain("'payout', 'Retiro solicitado a cuenta CLABE'");
      expect(sql).toContain("'Retiro en Proceso',");
      expect(sql).toContain(
        "'Tu solicitud de retiro por $' || p_amount::TEXT || ' ha sido recibida. El depósito se reflejará en los días de pago programados.',",
      );
      expect(sql).toContain("VALUES ('ERROR', 'Fallo en fn_request_payout', ");
      for (const drifted of ['Legacy payout request', 'Payout request received', 'Your legacy payout request', 'fn_request_payout failed']) {
        expect(sql).not.toContain(drifted);
      }
    });
  });
});
