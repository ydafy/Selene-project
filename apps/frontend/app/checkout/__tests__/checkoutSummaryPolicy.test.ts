import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(process.cwd(), 'apps/frontend');

const read = (relPath: string) => readFileSync(join(FRONTEND, relPath), 'utf8');

describe('checkout buyer summary policy', () => {
  const src = read('app/checkout/index.tsx');

  test('renders SummaryBreakdown and does not reference SellerPaymentBreakdown', () => {
    expect(src).toContain("from '../../components/features/checkout/SummaryBreakdown'");
    expect(src).toContain('<SummaryBreakdown');
    expect(src).not.toContain('SellerPaymentBreakdown');
    expect(src).not.toMatch(/SellerPaymentBreakdown\.(tsx|ts|jsx|js)/);
  });

  test('SellerPaymentBreakdown file is removed from the checkout feature folder', () => {
    expect(
      existsSync(
        join(FRONTEND, 'components/features/checkout/SellerPaymentBreakdown.tsx'),
      ),
    ).toBe(false);
  });
});
