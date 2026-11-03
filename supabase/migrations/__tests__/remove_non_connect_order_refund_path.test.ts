import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { withoutShipmentLink } from './shipmentNoticeLink';

/**
 * expo-push-notifications T6a (S8, L27): the non-Connect order and refund path
 * is removed. fn_create_order_from_payment and fn_complete_shipment_refund are
 * dropped, the two crons stop refunding a dispute whose shipment has no Stripe
 * payment intent, stripe-webhooks drops the app_name branch and
 * resolve-dispute-refund refuses such a dispute before it calls Stripe. These
 * tests read SQL and source text; `supabase db reset` plus psql probes prove
 * the SQL runs.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries');
const FUNCTIONS_DIR = join(import.meta.dir, '..', '..', 'functions');

const read = (path: string): string =>
  readFileSync(path, 'utf8').replace(/\r/g, '');
const collapse = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
  f.endsWith('_remove_non_connect_order_refund_path.sql'),
);
const migration =
  files.length === 1 ? read(join(MIGRATIONS_DIR, files[0])) : '';
const code = migration.replace(/--[^\n]*/g, '');

const PREVIOUS = read(
  join(MIGRATIONS_DIR, '20261027001250_remove_wallet_writes_disputes.sql'),
);

/** The text between the opening `$$` of a function and its closing `$$;`. */
const bodyOf = (sql: string, name: string): string => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`${name} is not defined`);
  const open = sql.indexOf('$$', start);
  return sql.slice(open + 2, sql.indexOf('$$;', open + 2));
};

const CRONS = [
  {
    name: 'fn_cron_dispute_payout_timeout',
    file: 'disputes/fn_cron_dispute_payout_timeout.sql',
  },
  {
    name: 'fn_cron_return_delivery_timeout',
    file: 'disputes/fn_cron_return_delivery_timeout.sql',
  },
] as const;

describe('remove_non_connect_order_refund_path migration', () => {
  test('exactly one migration exists and runs in one transaction', () => {
    expect(files.length).toBe(1);
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
  });

  test('drops both functions with exact signatures, after the crons are redefined, without CASCADE', () => {
    const refund = 'DROP FUNCTION public.fn_complete_shipment_refund(uuid);';
    const order =
      'DROP FUNCTION public.fn_create_order_from_payment(uuid, text, numeric, numeric, uuid, uuid[]);';
    expect(code).toContain(refund);
    expect(code).toContain(order);
    expect(code).not.toMatch(/CASCADE/i);
    for (const { name } of CRONS) {
      const created = code.indexOf(
        `CREATE OR REPLACE FUNCTION public.${name}(`,
      );
      expect(created).toBeGreaterThan(-1);
      expect(code.indexOf(refund)).toBeGreaterThan(created);
      expect(code.indexOf(order)).toBeGreaterThan(created);
    }
  });

  test('no remaining function body calls a dropped function', () => {
    expect(code).not.toMatch(
      /FROM public\.fn_complete_shipment_refund|PERFORM public\.fn_/,
    );
    expect(code).not.toContain('fn_create_order_from_payment(v_');
  });

  test('documents the grant review', () => {
    expect(migration).toMatch(/Grant review/);
  });

  for (const { name, file } of CRONS) {
    describe(name, () => {
      const body = collapse(bodyOf(migration, name));

      test('the non-Connect branch no longer refunds and logs one ERROR for manual intervention', () => {
        expect(body).not.toMatch(/FROM public\.fn_complete_shipment_refund/);
        expect(body).toMatch(
          /ELSE INSERT INTO public\.system_logs \(level, message, metadata\) VALUES \('ERROR', '[^']*no Stripe payment intent[^']*manual intervention[^']*', jsonb_build_object\('dispute_id', v_dispute\.id, 'shipment_id', v_dispute\.shipment_id\)\);/,
        );
      });

      test('everything but the non-Connect branch equals the previous canonical body', () => {
        const previous = collapse(bodyOf(PREVIOUS, name));
        const legacyStart = previous.indexOf(
          'ELSE -- Legacy path: refund via fn_complete_shipment_refund',
        );
        expect(legacyStart).toBeGreaterThan(-1);
        const rest = (text: string) => {
          const at = text.indexOf('ELSE', text.indexOf('IF v_is_connect THEN'));
          return text.slice(0, at);
        };
        // The Connect branch, the loop, the locking and every message before the
        // ELSE are byte-for-byte those of the previous body.
        expect(rest(body)).toBe(rest(previous));
        expect(rest(body).length).toBeGreaterThan(500);
        // The text after the replaced branch is unchanged too.
        const tail = (text: string, marker: string) =>
          text.slice(text.indexOf(marker));
        const marker =
          name === 'fn_cron_dispute_payout_timeout'
            ? 'IF NOT v_success THEN'
            : 'EXCEPTION WHEN OTHERS THEN';
        expect(tail(body, marker)).toBe(tail(previous, marker));
      });

      test('the dispute is left alone and no notice is written by the new branch', () => {
        const branch = body.slice(
          body.indexOf('ELSE INSERT INTO public.system_logs'),
        );
        const end = branch.indexOf(
          name === 'fn_cron_dispute_payout_timeout'
            ? 'END IF; IF NOT'
            : 'END IF; EXCEPTION',
        );
        const section = branch.slice(0, end);
        expect(section).not.toMatch(
          /UPDATE public\.disputes|INSERT INTO public\.notifications/,
        );
      });

      test('execute is limited to service_role, restated explicitly', () => {
        expect(code).toContain(
          `REVOKE ALL ON FUNCTION public.${name}() FROM PUBLIC, anon, authenticated;`,
        );
        expect(code).toContain(
          `GRANT EXECUTE ON FUNCTION public.${name}() TO service_role;`,
        );
      });

      test('the canonical file carries the migration body', () => {
        const canonical = withoutShipmentLink(read(join(QUERIES_DIR, file)))
          .split('\n')
          .filter((line) => !line.startsWith('--'))
          .join('\n');
        expect(collapse(canonical)).toBe(body);
      });
    });
  }

  test('the return-delivery cron counts the unrefundable dispute as an error', () => {
    const body = collapse(bodyOf(migration, 'fn_cron_return_delivery_timeout'));
    expect(body).toContain(
      "'shipment_id', v_dispute.shipment_id)); v_errors := v_errors + 1; END IF;",
    );
  });

  test('the canonical files of the dropped functions are gone', () => {
    expect(
      existsSync(
        join(QUERIES_DIR, 'shipments', 'fn_complete_shipment_refund.sql'),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(QUERIES_DIR, 'orders', 'fn_create_order_from_payment.sql'),
      ),
    ).toBe(false);
  });
});

describe('Edge Functions no longer use the removed path', () => {
  const webhooks = read(join(FUNCTIONS_DIR, 'stripe-webhooks', 'index.ts'));
  const refund = read(
    join(FUNCTIONS_DIR, 'resolve-dispute-refund', 'index.ts'),
  );

  test('stripe-webhooks has no fn_create_order_from_payment and no fraud check on payment_intent.succeeded', () => {
    expect(webhooks).not.toContain('fn_create_order_from_payment');
    expect(webhooks).not.toContain('FRAUDE DETECTADO');
    expect(webhooks).toContain('const { type, dispute_id } = intent.metadata;');
  });

  test('resolve-dispute-refund has no fn_complete_shipment_refund', () => {
    expect(refund).not.toContain('fn_complete_shipment_refund');
  });

  test('resolve-dispute-refund refuses a shipment without a payment intent before Stripe and before any write', () => {
    const refusal = refund.indexOf('refundIntentBlockedReason(');
    const stripeCall = refund.indexOf('stripe.refunds.create(');
    const write = refund.indexOf('.rpc(');
    expect(refusal).toBeGreaterThan(-1);
    expect(stripeCall).toBeGreaterThan(refusal);
    expect(write).toBeGreaterThan(refusal);
    expect(refund.slice(refusal, refusal + 400)).toContain('status: 422');
  });
});
