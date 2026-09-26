import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(import.meta.dir, '..', 'fn_resolve_product_verdict.sql'), 'utf8');

describe('product verdict notice producer', () => {
  it('guards same-status verdicts after locking and before any mutation', () => {
    expect(sql).toMatch(/SELECT p\.locked_by, p\.locked_at, p\.seller_id, p\.name, p\.status[\s\S]*?FOR UPDATE;/);
    const guard = sql.indexOf('IF (p_verdict = \'APPROVE\' AND v_status = \'VERIFIED\')');
    expect(guard).toBeGreaterThan(sql.indexOf('LOCK_EXPIRED_OR_STOLEN'));
    expect(guard).toBeLessThan(sql.indexOf('INSERT INTO public.admin_user_notes'));
    const noOp = sql.slice(guard, sql.indexOf('END IF;', guard));
    expect(noOp).toMatch(/UPDATE public\.products\s+SET locked_by = NULL,\s+locked_at = NULL\s+WHERE id = p_product_id;/);
    expect(noOp).toContain('RETURN true;');
  });

  it('uses the committed audit occurrence to publish one typed seller notice', () => {
    expect(sql).toMatch(/INSERT INTO public\.admin_audit_logs[\s\S]*?RETURNING id INTO v_audit_id;/);
    expect(sql).toContain("'product.approved_with_note'");
    expect(sql).toContain("'product.approved'");
    expect(sql).toContain("'product.rejected'");
    expect(sql).toContain("'product_id', p_product_id");
    expect(sql).toContain("'recipient_role', 'seller'");
    expect(sql).toMatch(/v_event_kind \|\| ':' \|\| p_product_id::text \|\| ':' \|\| v_audit_id::text/);
    expect(sql).toContain('ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING');
    expect(sql).not.toMatch(/event_payload[^;]*p_private_note/i);
    expect(sql).toContain("'/product/' || p_product_id::text");
    expect(sql).toContain("'/verify/' || p_product_id::text");
  });
});
