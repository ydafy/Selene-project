import { expect, test } from 'bun:test';
import {
  isValidRejectionReason,
  resolveVerdictPayload,
} from './resolveVerdict';

test('admin action and RPC hook use canonical verdict payload', async () => {
  const actions = await Bun.file(
    new URL('./VerificationActions.tsx', import.meta.url),
  ).text();
  const hook = await Bun.file(
    new URL('../../../hooks/usePendingProducts.ts', import.meta.url),
  ).text();
  expect(actions).not.toContain('APPROVE_NOTE');
  expect(actions).toContain("verdict: 'APPROVE'");
  expect(hook).toContain('resolveVerdictPayload(verdict, note)');
  expect(actions.match(/isValidRejectionReason\(adminNote\)/g)).toHaveLength(2);
  expect(actions).toMatch(/handleConfirm[\s\S]*isValidRejectionReason\(adminNote\)[\s\S]*resolve\.mutate\(/);
});

test('rejection requires at least ten non-padding characters', () => {
  expect(isValidRejectionReason(' 123456789 ')).toBe(false);
  expect(isValidRejectionReason(' 1234567890 ')).toBe(true);
  expect(isValidRejectionReason('  \n  ')).toBe(false);
});

test('approval with public note uses APPROVE and sends trimmed seller-facing text', () => {
  expect(resolveVerdictPayload('APPROVE', '  Please improve photos  ')).toEqual({
    p_verdict: 'APPROVE',
    p_public_note: 'Please improve photos',
  });
});

test('whitespace-only approval note is omitted', () => {
  expect(resolveVerdictPayload('APPROVE', '  \n ')).toEqual({
    p_verdict: 'APPROVE',
    p_public_note: undefined,
  });
});

test('rejection keeps its verdict and trimmed public reason', () => {
  expect(resolveVerdictPayload('REJECT', '  Not compliant  ')).toEqual({
    p_verdict: 'REJECT',
    p_public_note: 'Not compliant',
  });
});
