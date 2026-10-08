import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, '..', 'fn_resolve_dispute_to_buyer.sql'), 'utf8');

describe('buyer dispute verdict producer', () => {
  it('retains the locked, gated admin transition and failure shape', () => {
    for (const marker of ["request.jwt.claims", "role = 'admin'", 'FOR UPDATE', "'open', 'under_review'", "status = 'waiting_return'", "resolution_type = 'buyer'", 'EXCEPTION WHEN OTHERS', 'public.system_logs', "'INTERNAL_SERVER_ERROR'"]) expect(source).toContain(marker);
  });
  it('uses the committed audit occurrence and locked participants for one idempotent projection', () => {
    expect(source).toMatch(/INSERT INTO public\.admin_audit_logs[\s\S]*?RETURNING id INTO v_audit_id;/);
    expect(source).toContain("'dispute.verdict:' || p_dispute_id::text || ':' || v_audit_id::text");
    expect(source).toMatch(/INSERT INTO public\.notifications[\s\S]*?SELECT[\s\S]*?FROM \(VALUES[\s\S]*?\) AS recipients[\s\S]*?WHERE true[\s\S]*?ON CONFLICT \(source_event_key, user_id\) WHERE source_event_key IS NOT NULL DO NOTHING;/);
    expect(source).toContain('v_buyer_id');
    expect(source).toContain('v_seller_id');
    expect(source).toContain('v_seller_id IS DISTINCT FROM v_buyer_id');
    expect(source).toContain("'dispute.verdict'");
    expect(source).toContain("jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id, 'recipient_role', recipients.recipient_role)");
    expect(source).not.toMatch(/jsonb_build_object\([^;]*p_admin_note[^;]*recipient_role/);
    expect(source).toContain('Tu devolución fue aprobada. Consulta el pedido');
    expect(source).toContain('Se aprobó la devolución. Consulta el pedido');
    expect(source).not.toMatch(/reembolsar|reembolsó|reembolsará|refund confirmed|48h/i);
  });
});
