import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for the push outbox (expo-push-notifications T2/S1/S2/S3/S5).
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

const migration = findMigration('push_outbox');
const code = normalize(migration);

const EXPECTED_POLICY = [
  ['order.payment_confirmed', 'seller', 'orders'],
  ['shipment.cancelled', 'buyer', 'orders'],
  ['shipment.cancelled', 'seller', 'orders'],
  ['shipment.refund_failed', 'buyer', 'orders'],
  ['dispute.opened', 'seller', 'orders'],
  ['dispute.verdict', 'buyer', 'orders'],
  ['dispute.verdict', 'seller', 'orders'],
  ['return.delivered', 'buyer', 'orders'],
  ['return.delivered', 'seller', 'orders'],
  ['return.seller_evidence_submitted', 'buyer', 'orders'],
  ['product.approved', 'seller', 'orders'],
  ['product.approved_with_note', 'seller', 'orders'],
  ['product.rejected', 'seller', 'orders'],
  ['product.available', 'buyer', 'activity'],
  ['product.interest', 'seller', 'activity'],
];

describe('push_event_policy allowlist', () => {
  test('has the policy columns and checks', () => {
    expect(code).toContain('CREATE TABLE public.push_event_policy');
    expect(code).toContain('event_kind text NOT NULL');
    expect(code).toContain("recipient_role text NOT NULL CHECK (recipient_role IN ('buyer', 'seller'))");
    expect(code).toContain("channel text NOT NULL CHECK (channel IN ('orders', 'activity'))");
    expect(code).toContain('PRIMARY KEY (event_kind, recipient_role)');
  });

  test('is closed to every client role', () => {
    expect(code).toContain('ALTER TABLE public.push_event_policy ENABLE ROW LEVEL SECURITY;');
    expect(code).toContain('REVOKE ALL ON TABLE public.push_event_policy FROM PUBLIC, anon, authenticated;');
    expect(code).toContain('GRANT ALL ON TABLE public.push_event_policy TO service_role;');
  });

  test('seeds exactly the L4 matrix', () => {
    const seed = code.match(/INSERT INTO public\.push_event_policy \(event_kind, recipient_role, channel\) VALUES (.*?);/)?.[1];
    expect(seed).toBeDefined();
    const rows = [...seed!.matchAll(/\('([^']+)', '([^']+)', '([^']+)'\)/g)].map((m) => [m[1], m[2], m[3]]);
    expect(rows).toEqual(EXPECTED_POLICY);
  });

  test('never pushes order.payment_confirmed to the buyer (S5)', () => {
    expect(code).not.toContain("('order.payment_confirmed', 'buyer'");
  });

  test('every seeded kind exists in the newest event kind catalogue', () => {
    const catalogue = normalize(findMigration('product_interest_notification'));
    for (const [kind] of EXPECTED_POLICY) {
      expect(catalogue).toContain(`'${kind}'`);
    }
  });
});

describe('push_deliveries outbox', () => {
  test('has the outbox columns', () => {
    expect(code).toContain('CREATE TABLE public.push_deliveries');
    expect(code).toContain('id uuid PRIMARY KEY DEFAULT gen_random_uuid()');
    expect(code).toContain('notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE');
    expect(code).toContain('push_token_id uuid NOT NULL REFERENCES public.push_tokens(id) ON DELETE CASCADE');
    expect(code).toContain('user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(code).toContain("channel text NOT NULL CHECK (channel IN ('orders', 'activity'))");
    expect(code).toContain(
      "status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped'))",
    );
    expect(code).toContain('attempts integer NOT NULL DEFAULT 0');
    expect(code).toContain('next_attempt_at timestamptz NOT NULL DEFAULT now()');
    expect(code).toContain('claim_token uuid');
    expect(code).toContain('claimed_at timestamptz');
    expect(code).toContain('expo_ticket_id text');
    expect(code).toContain('last_error text');
    expect(code).toContain('sent_at timestamptz');
    expect(code).toContain('created_at timestamptz NOT NULL DEFAULT now()');
    expect(code).toContain('updated_at timestamptz NOT NULL DEFAULT now()');
  });

  test('is unique per notification and token and indexes the claim scan', () => {
    expect(code).toContain('UNIQUE (notification_id, push_token_id)');
    expect(code).toContain(
      "CREATE INDEX push_deliveries_claim_idx ON public.push_deliveries (next_attempt_at) WHERE status IN ('pending', 'sending');",
    );
    expect(code).toContain('CREATE INDEX push_deliveries_push_token_idx ON public.push_deliveries (push_token_id);');
  });

  test('is closed to every client role', () => {
    expect(code).toContain('ALTER TABLE public.push_deliveries ENABLE ROW LEVEL SECURITY;');
    expect(code).toContain('REVOKE ALL ON TABLE public.push_deliveries FROM PUBLIC, anon, authenticated;');
    expect(code).toContain('GRANT ALL ON TABLE public.push_deliveries TO service_role;');
    expect(code).not.toMatch(/CREATE POLICY/i);
  });
});

describe('fan-out trigger', () => {
  const def = definition(migration, 'fn_enqueue_push_deliveries')!;

  test('fires after each notification insert, only for typed rows', () => {
    expect(code).toContain(
      'CREATE TRIGGER trg_notifications_enqueue_push AFTER INSERT ON public.notifications FOR EACH ROW WHEN (NEW.event_kind IS NOT NULL) EXECUTE FUNCTION public.fn_enqueue_push_deliveries();',
    );
  });

  test('is a definer with a pinned search_path that nobody can call directly', () => {
    expect(def).toBeDefined();
    expect(def).toContain('RETURNS trigger');
    expect(def).toContain('SECURITY DEFINER');
    expect(def).toContain('SET search_path = public, pg_temp');
    expect(code).toContain(
      'REVOKE EXECUTE ON FUNCTION public.fn_enqueue_push_deliveries() FROM PUBLIC, anon, authenticated;',
    );
    expect(code).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_enqueue_push_deliveries/);
  });

  test('fans out to active tokens of open accounts for allowlisted kind and role', () => {
    expect(def).toContain('FROM public.push_event_policy pol');
    expect(def).toContain('t.user_id = NEW.user_id AND t.disabled_at IS NULL');
    expect(def).toContain('JOIN public.profiles p ON p.id = NEW.user_id AND p.deleted_at IS NULL');
    expect(def).toContain("pol.recipient_role = NEW.event_payload->>'recipient_role'");
    expect(def).toContain('ON CONFLICT (notification_id, push_token_id) DO NOTHING');
  });

  test('never raises, so a producer cannot fail on push data', () => {
    expect(def).not.toMatch(/RAISE/i);
  });

  test('locks the tokens it reads, so a concurrent token delete cannot fail the producer on the foreign key', () => {
    expect(def).toContain('FOR KEY SHARE OF t');
  });
});

describe('dispatcher RPCs', () => {
  for (const [name, args] of [
    ['fn_claim_push_deliveries', 'integer, interval'],
    ['fn_record_push_results', 'jsonb'],
  ] as const) {
    test(`${name} is a service-role-only definer with a pinned search_path`, () => {
      const def = definition(migration, name);
      expect(def).toBeDefined();
      expect(def).toContain('SECURITY DEFINER');
      expect(def).toContain('SET search_path = public, pg_temp');
      expect(def).toContain("auth.role() IS DISTINCT FROM 'service_role'");
      expect(code).toContain(
        `REVOKE EXECUTE ON FUNCTION public.${name}(${args}) FROM PUBLIC, anon, authenticated;`,
      );
      expect(code).toContain(`GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO service_role;`);
      expect(code).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}[^;]*(anon|PUBLIC|authenticated)`));
    });
  }

  test('claim bounds the limit, uses SKIP LOCKED and a lease for sending rows', () => {
    const def = definition(migration, 'fn_claim_push_deliveries')!;
    expect(def).toContain('p_limit integer');
    expect(def).toContain("p_max_age interval DEFAULT interval '6 hours'");
    expect(def).toContain('p_limit IS NULL OR p_limit < 1 OR p_limit > 500');
    expect(def).toContain('FOR UPDATE OF d SKIP LOCKED');
    expect(def).toContain("d.status = 'sending' AND d.claimed_at <= now() - interval '5 minutes'");
    expect(def).toContain('attempts = d.attempts +');
  });

  test('claim rejects a missing or non-positive max age', () => {
    const def = definition(migration, 'fn_claim_push_deliveries')!;
    expect(def).toContain("p_max_age IS NULL OR p_max_age <= interval '0'");
    expect(def).toContain('INVALID_PUSH_CLAIM_MAX_AGE');
  });

  test('claim never sends to a token that moved to another user', () => {
    const def = definition(migration, 'fn_claim_push_deliveries')!;
    expect(def).toContain("WHEN t.user_id IS DISTINCT FROM d.user_id THEN 'token_reassigned'");
    // A move that commits between the skip check and the final read is caught again.
    expect(def).toContain('AND t.user_id = upd.user_id');
  });

  test('claim skips read, deleted, expired, disabled-token and closed-account rows with a reason', () => {
    const def = definition(migration, 'fn_claim_push_deliveries')!;
    for (const reason of [
      'notification_read',
      'notification_deleted',
      'expired',
      'token_disabled',
      'account_closed',
      'attempts_exhausted',
    ]) {
      expect(def).toContain(`'${reason}'`);
    }
    expect(def).toContain('last_error = COALESCE(due.skip_reason, d.last_error)');
  });

  test('record results validates the batch and ignores stale claims', () => {
    const def = definition(migration, 'fn_record_push_results')!;
    expect(def).toContain('INVALID_PUSH_RESULTS');
    expect(def).toContain("jsonb_typeof(p_results) IS DISTINCT FROM 'array'");
    expect(def).toContain("v_item->>'outcome' NOT IN ('sent', 'retry', 'failed')");
    expect(def).toContain("d.claim_token = v_claim_token AND d.status = 'sending'");
    expect(def).toContain('expo_ticket_id = v_ticket_id');
    expect(def).toContain('sent_at = now()');
    expect(def).toContain("THEN 'failed' ELSE 'pending'");
    expect(def).toContain('UPDATE public.push_tokens');
    expect(def).toContain('disabled_at = now()');
  });

  test('grant review is explained in the header', () => {
    expect(migration).toContain('Grant review');
  });
});

describe('closed account cannot register a token', () => {
  const closed = findMigration('register_push_token_closed_account');
  const canonical = readFileSync(join(QUERIES_DIR, 'push', 'fn_register_push_token.sql'), 'utf8');

  test('the migration and the canonical function raise ACCOUNT_CLOSED', () => {
    for (const sql of [closed, canonical]) {
      const def = definition(sql, 'fn_register_push_token')!;
      expect(def).toContain('ACCOUNT_CLOSED');
      expect(def).toContain('profiles');
      expect(def).toContain('deleted_at IS NOT NULL');
    }
  });

  test('the migration body equals the canonical function', () => {
    expect(rawDefinition(closed, 'fn_register_push_token')).toBeDefined();
    expect(rawDefinition(closed, 'fn_register_push_token')).toBe(rawDefinition(canonical, 'fn_register_push_token'));
  });

  test('the grants stay authenticated-only', () => {
    const norm = normalize(closed);
    expect(norm).toContain('REVOKE EXECUTE ON FUNCTION public.fn_register_push_token(text, text) FROM PUBLIC, anon;');
    expect(norm).toContain('GRANT EXECUTE ON FUNCTION public.fn_register_push_token(text, text) TO authenticated;');
  });
});

describe('canonical SQL parity', () => {
  for (const name of ['fn_enqueue_push_deliveries', 'fn_claim_push_deliveries', 'fn_record_push_results']) {
    test(`${name} canonical file matches the migration`, () => {
      const canonical = readFileSync(join(QUERIES_DIR, 'push', `${name}.sql`), 'utf8');
      expect(rawDefinition(canonical, name)).toBeDefined();
      expect(rawDefinition(canonical, name)).toBe(rawDefinition(migration, name));
    });
  }
});
