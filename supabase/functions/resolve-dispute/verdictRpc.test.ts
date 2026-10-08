import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildVerdictRpc } from './verdictRpc.ts';

const payload = { disputeId: 'dispute', adminNote: 'valid note', verdict: 'buyer' as const,
  p_admin_id: 'attacker', adminId: 'attacker' };

test('buyer dispatch uses verified actor, ignoring spoofed body identity', () => {
  expect(buildVerdictRpc(payload, 'verified')).toEqual({
    name: 'fn_resolve_dispute_to_buyer_as_admin',
    args: { p_dispute_id: 'dispute', p_admin_note: 'valid note', p_admin_id: 'verified' },
  });
});

test('seller dispatch uses verified actor, ignoring spoofed body identity', () => {
  expect(buildVerdictRpc({ ...payload, verdict: 'seller' }, 'verified')).toEqual({
    name: 'fn_resolve_dispute_to_seller_as_admin',
    args: { p_dispute_id: 'dispute', p_admin_note: 'valid note', p_admin_id: 'verified' },
  });
});

test('Edge authenticates and authorizes before dispatching validated inputs with user.id', () => {
  const edge = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const dispatch = edge.indexOf('buildVerdictRpc({ disputeId, verdict, adminNote }, user.id)');
  expect(dispatch).toBeGreaterThan(edge.indexOf('RequestSchema.parse(body)'));
  expect(edge.indexOf('RequestSchema.parse(body)')).toBeGreaterThan(edge.indexOf("profile?.role !== 'admin'"));
  expect(edge.indexOf("profile?.role !== 'admin'")).toBeGreaterThan(edge.indexOf('if (authError || !user)'));
  expect(edge).toContain('supabaseAdmin.auth.getUser(');
  expect(edge).toContain('rpc.name, rpc.args');
});
