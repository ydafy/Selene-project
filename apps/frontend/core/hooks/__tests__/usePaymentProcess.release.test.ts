import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const frontendRoot = join(import.meta.dir, '..', '..', '..');
const hookSource = readFileSync(
  join(frontendRoot, 'core/hooks/usePaymentProcess.ts'),
  'utf8',
);

const SKIPPED_DIRS = new Set(['node_modules', '.expo', 'dist', '__tests__']);

function collectSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return SKIPPED_DIRS.has(name) ? [] : collectSources(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe('client never releases products directly (S3)', () => {
  it('no frontend source calls the fn_release_products RPC', () => {
    const offenders = collectSources(frontendRoot).filter((file) =>
      readFileSync(file, 'utf8').includes('fn_release_products'),
    );

    expect(offenders).toEqual([]);
  });

  it('RESERVATION_FAILED and SELLER_NOT_ONBOARDED release nothing from the client', () => {
    expect(hookSource).not.toContain('releaseProductIds');
    expect(hookSource).not.toMatch(/supabase\s*\.rpc\(/);
  });

  it('rollback failure does not fall back to a direct release', () => {
    const rollbackBlock = hookSource.slice(
      hookSource.indexOf('const rollbackOrReleaseSession'),
      hookSource.indexOf('const disposeActiveSession'),
    );

    expect(rollbackBlock).toContain('[PAYMENT_ROLLBACK_ERROR]');
    expect(rollbackBlock).not.toMatch(/releaseProductIds|\.rpc\(/);
  });

  it('keeps calling rollback-connect-payment with the same payload', () => {
    expect(hookSource).toContain("'rollback-connect-payment'");
    expect(hookSource).toContain('orderId: session.orderId');
    expect(hookSource).toContain('paymentIntentIds: [session.paymentIntentId]');
  });
});
