import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = () => readFileSync(join(import.meta.dir, '..', 'fn_seller_submit_return_evidence.sql'), 'utf8');
describe('seller return evidence notice', () => {
  it('fails closed on absent caller, wrong owner, nullable state, or mismatched participants', () => {
    const text = sql();
    expect(text).toContain('FOR UPDATE');
    expect(text).toContain('v_auth_user_id IS NULL');
    expect(text).toContain('v_seller_id IS DISTINCT FROM v_auth_user_id');
    expect(text).toContain("v_status IS DISTINCT FROM 'return_delivered'");
    for (const clause of ['s.order_id = o.id', 's.id = v_shipment_id', 'o.buyer_id = v_buyer_id', 's.seller_id = v_seller_id']) expect(text).toContain(clause);
  });
  it('rejects empty or missing photo/video before any transition or notice', () => {
    const text = sql();
    expect(text).toContain("NOT EXISTS (SELECT 1 FROM unnest(p_images) AS evidence_url(url) WHERE NULLIF(btrim(evidence_url.url), '') IS NOT NULL)");
    expect(text).toContain("NULLIF(btrim(p_video_url), '') IS NULL");
    expect(text).toContain("RETURN QUERY SELECT false, 'EVIDENCE_REQUIRED'::TEXT; RETURN;");
    expect(text.indexOf('EVIDENCE_REQUIRED')).toBeLessThan(text.indexOf('UPDATE public.disputes'));
  });
  it('persists occurrence with evidence and inserts one private buyer notice', () => {
    const text = sql();
    expect(text).toMatch(/seller_evidence = jsonb_build_object\([\s\S]*?'notification_event_id', gen_random_uuid\(\)/);
    expect(text).toContain('RETURNING seller_evidence->>\'notification_event_id\' INTO v_occurrence_id');
    expect(text).toContain("'return.seller_evidence_submitted:' || p_dispute_id::text || ':' || v_occurrence_id");
    expect(text).toContain('v_buyer_id IS DISTINCT FROM v_auth_user_id');
    expect(text).toContain("'recipient_role', 'buyer'");
    expect(text).toContain('ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING');
    expect(text).not.toMatch(/RETURN QUERY SELECT false, SQLERRM/);
  });
});
