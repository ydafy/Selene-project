import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(import.meta.dir, '..', '..', '..', '..');

const read = (relPath: string) => readFileSync(join(FRONTEND, relPath), 'utf8');

describe('checkout buyer summary policy', () => {
  const src = read('src/app/checkout/index.tsx');

  test('renders SummaryBreakdown and does not reference SellerPaymentBreakdown', () => {
    expect(src).toContain(
      "from '../../features/checkout/components/summary-breakdown'",
    );
    expect(src).toContain('<SummaryBreakdown');
    expect(src).not.toContain('SellerPaymentBreakdown');
    expect(src).not.toMatch(/SellerPaymentBreakdown\.(tsx|ts|jsx|js)/);
  });

  test('SellerPaymentBreakdown file is removed from the checkout feature folder', () => {
    expect(
      existsSync(
        join(
          FRONTEND,
          'src/features/checkout/components/seller-payment-breakdown.tsx',
        ),
      ),
    ).toBe(false);
  });
});
