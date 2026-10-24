import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter((name) =>
  name.endsWith('_shipment_cancellation_carrier_review.sql'),
);
const migration = migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !/^\s*(--|BEGIN;|COMMIT;)/.test(line) && line.trim() !== '')
    .join('\n');
const review = read('supabase/queries/orders/shipment_cancellation_carrier_review.sql');
const body = statements(review);
const functionBody = (name: string) => {
  const start = body.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = body.indexOf('\n$$;', start);
  return start === -1 || end === -1 ? '' : body.slice(start, end);
};

// Text contracts only; the local `supabase db reset` + scripts/test-shipment-carrier-review.ts
// prove the behavior in PostgreSQL.
describe('shipment cancellation carrier review migration (SQL text)', () => {
  it('is exactly one active migration identical to the canonical copy', () => {
    expect(migrations).toHaveLength(1);
    expect(statements(migration)).toBe(body);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('is ordered after the B4.2 carrier outcome migration it builds on', () => {
    const outcome = readdirSync(join(root, 'supabase/migrations')).find((name) =>
      name.endsWith('_shipment_carrier_cancellation_outcome.sql'),
    );
    expect(outcome).toBeDefined();
    expect(migrations[0]! > outcome!).toBe(true);
  });

  it('adds the review columns with paired and ordered CHECKs', () => {
    expect(body).toContain('ADD COLUMN review_reason TEXT');
    expect(body).toContain("review_reason IN ('tracking_unknown', 'carrier_refused', 'carrier_ambiguous')");
    expect(body).toContain('ADD COLUMN review_required_at TIMESTAMPTZ');
    expect(body).toContain('ADD COLUMN review_resolution TEXT');
    expect(body).toContain("review_resolution IN ('refund_approved', 'closed_no_refund')");
    expect(body).toContain('ADD COLUMN review_resolved_at TIMESTAMPTZ');
    expect(body).toContain('ADD COLUMN review_resolved_by UUID');
    expect(body).toContain('ADD COLUMN review_resolution_note TEXT');
    expect(body).toContain('(review_reason IS NULL) = (review_required_at IS NULL)');
    expect(body).toContain('review_resolution IS NULL OR review_required_at IS NOT NULL');
  });

  it('allows the label loss with an accepted outcome or an approved refund only', () => {
    expect(body).toContain(
      'DROP CONSTRAINT shipment_cancellation_operations_carrier_balance_consistent',
    );
    const constraint = body.slice(
      body.indexOf('ADD CONSTRAINT shipment_cancellation_operations_carrier_balance_consistent'),
    );
    expect(constraint).toContain("review_resolution IS NOT DISTINCT FROM 'refund_approved'");
    expect(constraint).toContain("carrier_cancellation_outcome = 'accepted' AND carrier_balance_returned IS NOT NULL");
    expect(constraint).toContain('carrier_balance_returned IS NULL');
    expect(constraint).toContain('carrier_balance_returned_at IS NULL');
    expect(body.replace(/DROP CONSTRAINT[^\n]*/g, '')).not.toMatch(/DROP\s/i);
  });

  it('declares every new RPC as a locked-down service-only SECURITY DEFINER with a grant review', () => {
    for (const name of [
      'fn_get_shipment_carrier_cancellation',
      'fn_mark_shipment_cancellation_review',
      'fn_resolve_shipment_cancellation_review',
      'fn_list_shipment_cancellation_reviews',
    ]) {
      const fn = functionBody(name);
      expect(fn).toContain('SECURITY DEFINER');
      expect(fn).toContain("SET search_path = ''");
      expect(fn).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;");
      expect(migration).toMatch(
        new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`),
      );
      expect(migration).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO service_role;`),
      );
    }
    expect(migration).toContain('-- Grant review');
    expect(migration).not.toMatch(/GRANT[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i);
  });

  it('marks a review once, only for the live preparing-timeout claim, shipment locked before the operation', () => {
    const fn = functionBody('fn_mark_shipment_cancellation_review');
    for (const error of [
      'INVALID_REVIEW_REASON',
      'SHIPMENT_NOT_FOUND',
      'STALE_CANCELLATION_CLAIM',
      'INVALID_CARRIER_CANCELLATION_SOURCE',
      'CANCELLATION_EXTERNAL_ALREADY_STARTED',
      'CANCELLATION_CLAIM_EXPIRED',
      'SHIPMENT_NOT_CANCELABLE',
    ]) {
      expect(fn).toContain(`RAISE EXCEPTION '${error}'`);
    }
    expect(fn).toContain("'marked'");
    expect(fn.indexOf('FROM public.shipments WHERE id = p_shipment_id FOR UPDATE')).toBeGreaterThan(-1);
    expect(fn.indexOf('FROM public.shipments WHERE id = p_shipment_id FOR UPDATE')).toBeLessThan(
      fn.indexOf('FROM public.shipment_cancellation_operations'),
    );
  });

  it('resolves a pending review as an active admin with a note, deriving the label loss in SQL', () => {
    const fn = functionBody('fn_resolve_shipment_cancellation_review');
    expect(fn).toContain(
      "WHERE id = p_admin_id AND role = 'admin' AND COALESCE(status::text, 'active') = 'active'",
    );
    for (const error of [
      'ADMIN_REQUIRED',
      'INVALID_REVIEW_RESOLUTION',
      'INVALID_REVIEW_NOTE',
      'SHIPMENT_NOT_FOUND',
      'CARRIER_REVIEW_NOT_PENDING',
      'CARRIER_REVIEW_ALREADY_RESOLVED',
      'CANCELLATION_EXTERNAL_ALREADY_STARTED',
      'SHIPMENT_NOT_CANCELABLE',
    ]) {
      expect(fn).toContain(`RAISE EXCEPTION '${error}'`);
    }
    expect(fn).toContain('v_shipment.label_provider_cost_cents');
    expect(fn).not.toMatch(/p_label_cost|p_loss/i);
    expect(fn.indexOf('FROM public.shipments WHERE id = p_shipment_id FOR UPDATE')).toBeLessThan(
      fn.indexOf('FROM public.shipment_cancellation_operations'),
    );
  });

  it('lists only pending reviews, oldest first', () => {
    const fn = functionBody('fn_list_shipment_cancellation_reviews');
    expect(fn).toContain('o.review_required_at IS NOT NULL');
    expect(fn).toContain('o.review_resolution IS NULL');
    expect(fn).toContain('ORDER BY p.review_required_at ASC, p.shipment_id ASC');
    expect(fn).toContain('RETURNS TABLE');
  });

  it('lets the refund start accept an approved review and keeps every previous check', () => {
    const start = functionBody('fn_start_shipment_cancellation_refund');
    expect(start).toContain("v_operation.source = 'preparing_timeout'");
    expect(start).toContain("v_operation.carrier_cancellation_outcome IS DISTINCT FROM 'accepted'");
    expect(start).toContain("v_operation.review_resolution IS DISTINCT FROM 'refund_approved'");
    expect(start).toContain("RAISE EXCEPTION 'CARRIER_CANCELLATION_NOT_CONFIRMED'");
    expect(start.indexOf('CARRIER_CANCELLATION_NOT_CONFIRMED')).toBeLessThan(
      start.indexOf('UPDATE public.shipment_cancellation_operations'),
    );
    expect(start).toContain("RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST'");
    expect(start).toContain("RAISE EXCEPTION 'INVALID_CANCELLATION_LOSS'");
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.fn_start_shipment_cancellation\(UUID, UUID\) FROM PUBLIC, anon, authenticated, service_role;/,
    );
  });

  it('makes the claim reject a pending or closed review before rotating the token', () => {
    const claim = functionBody('fn_claim_shipment_cancellation');
    expect(claim).toContain("RAISE EXCEPTION 'SHIPMENT_CANCELLATION_UNDER_REVIEW'");
    expect(claim).toContain("RAISE EXCEPTION 'SHIPMENT_CANCELLATION_REVIEW_CLOSED'");
    expect(claim.indexOf('SHIPMENT_CANCELLATION_UNDER_REVIEW')).toBeLessThan(
      claim.indexOf('SET claim_token = gen_random_uuid()'),
    );
    expect(claim.indexOf('SHIPMENT_CANCELLATION_REVIEW_CLOSED')).toBeLessThan(
      claim.indexOf('SET claim_token = gen_random_uuid()'),
    );
    // Existing checks stay.
    for (const error of [
      'INVALID_CANCELLATION_CONTEXT',
      'SHIPMENT_NOT_FOUND',
      'SHIPMENT_ORDER_MISMATCH',
      'ORDER_BUYER_MISMATCH',
      'SHIPMENT_SELLER_MISMATCH',
      'SHIPMENT_NOT_CANCELABLE',
      'SHIPMENT_FUNDS_ALREADY_RELEASED',
      'SHIPMENT_LABEL_OPERATION_ACTIVE',
      'SHIPMENT_TRANSFER_OPERATION_ACTIVE',
    ]) {
      expect(claim).toContain(`RAISE EXCEPTION '${error}'`);
    }
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.fn_claim_shipment_cancellation\([^)]*\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_claim_shipment_cancellation\([^)]*\) TO service_role;/,
    );
  });
});
