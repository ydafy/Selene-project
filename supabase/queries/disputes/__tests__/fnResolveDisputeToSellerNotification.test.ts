import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dir, '..', 'fn_resolve_dispute_to_seller.sql'), 'utf8');

describe('seller dispute verdict producer', () => {
  it('retains the gated financial transition and failure shape', () => {
    for (const marker of ["request.jwt.claims", "role = 'admin'", 'FOR UPDATE', "'open', 'under_review', 'return_delivered', 'waiting_return'", 'stripe_payment_intent_id IS NOT NULL', 'public.wallet_transactions', "status = 'completed'", 'EXCEPTION WHEN OTHERS', 'public.system_logs', "'INTERNAL_SERVER_ERROR'"]) expect(source).toContain(marker);
    expect(source).toMatch(/END IF;\s*-- F\. ACTUALIZAR ESTADOS/);
  });
  it('projects one role-specific notice per audited verdict occurrence', () => {
    expect(source).toMatch(/INSERT INTO public\.admin_audit_logs[\s\S]*?RETURNING id INTO v_audit_id;/);
    expect(source).toContain("'dispute.verdict:' || p_dispute_id::text || ':' || v_audit_id::text");
    expect(source).toMatch(/INSERT INTO public\.notifications[\s\S]*?SELECT[\s\S]*?FROM \(VALUES[\s\S]*?\) AS recipients[\s\S]*?WHERE true[\s\S]*?ON CONFLICT \(source_event_key, user_id\) WHERE source_event_key IS NOT NULL DO NOTHING;/);
    expect(source).toContain('v_seller_id IS DISTINCT FROM v_buyer_id');
    expect(source).toContain("'dispute.verdict'");
    expect(source).toContain("jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id, 'recipient_role', recipients.recipient_role)");
    expect(source).not.toMatch(/jsonb_build_object\([^;]*p_admin_note[^;]*recipient_role/);
    expect(source).not.toMatch(/Fondos liberados|reembolso completado|reembolsado/i);
  });
});
