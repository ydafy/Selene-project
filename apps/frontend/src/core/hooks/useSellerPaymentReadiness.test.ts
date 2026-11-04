import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let rpcResult: { data: unknown; error: unknown } = { data: [], error: null };
let rpcThrows = false;
const rpcCalls: Array<[string, unknown]> = [];

mock.module('../db/supabase', () => ({
  supabase: {
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      if (rpcThrows) throw new Error('network down');
      return rpcResult;
    },
  },
}));

// Bun module mocks are process-wide: keep the real exports so later test files that
// import useQueryClient (or anything else) still find them.
const reactQuery = await import('@tanstack/react-query');
mock.module('@tanstack/react-query', () => ({
  ...reactQuery,
  useQuery: () => ({ data: undefined }),
}));

const { fetchSellerPaymentReadiness, parseReadinessRows, isSellerBlocked } =
  await import('./useSellerPaymentReadiness');

const frontendRoot = join(import.meta.dir, '..', '..');
const read = (p: string) => readFileSync(join(frontendRoot, p), 'utf8');

beforeEach(() => {
  rpcResult = { data: [], error: null };
  rpcThrows = false;
  rpcCalls.length = 0;
});

describe('parseReadinessRows', () => {
  it('maps valid rows by product id', () => {
    expect(
      parseReadinessRows([
        { product_id: 'a', seller_accepts_payments: true },
        { product_id: 'b', seller_accepts_payments: false },
      ]),
    ).toEqual({ a: true, b: false });
  });

  it('rejects malformed rows', () => {
    expect(() => parseReadinessRows([{ product_id: 'a' }])).toThrow();
    expect(() => parseReadinessRows('nope')).toThrow();
  });
});

describe('fetchSellerPaymentReadiness', () => {
  it('calls the RPC with the product ids', async () => {
    rpcResult = {
      data: [{ product_id: 'a', seller_accepts_payments: false }],
      error: null,
    };
    const map = await fetchSellerPaymentReadiness(['a']);
    expect(rpcCalls).toEqual([
      ['fn_product_seller_payment_readiness', { p_product_ids: ['a'] }],
    ]);
    expect(map).toEqual({ a: false });
  });

  it('returns an empty map without calling for no ids', async () => {
    expect(await fetchSellerPaymentReadiness([])).toEqual({});
    expect(rpcCalls).toHaveLength(0);
  });

  it('chunks requests to the 50 id RPC limit', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `p${i}`);
    await fetchSellerPaymentReadiness(ids);
    expect(rpcCalls).toHaveLength(2);
  });

  it('fails open when the RPC returns an error', async () => {
    rpcResult = { data: null, error: { message: 'boom' } };
    expect(await fetchSellerPaymentReadiness(['a'])).toEqual({});
  });

  it('fails open when the RPC throws', async () => {
    rpcThrows = true;
    expect(await fetchSellerPaymentReadiness(['a'])).toEqual({});
  });

  it('fails open when the response is malformed', async () => {
    rpcResult = { data: [{ product_id: 1 }], error: null };
    expect(await fetchSellerPaymentReadiness(['a'])).toEqual({});
  });
});

describe('isSellerBlocked', () => {
  it('only an explicit false blocks', () => {
    expect(isSellerBlocked({ a: false }, 'a')).toBe(true);
    expect(isSellerBlocked({ a: true }, 'a')).toBe(false);
    expect(isSellerBlocked({}, 'a')).toBe(false);
    expect(isSellerBlocked(undefined, 'a')).toBe(false);
  });
});

describe('screen and hook wiring (S4)', () => {
  it('useProductCart decides through the gate after reading the fresh status', () => {
    const src = read('components/features/product/hooks/useProductCart.ts');
    expect(src).toContain('decidePurchaseGate');
    expect(src).toContain('fetchSellerPaymentReadiness');
    expect(src).not.toContain('sellerNotReady');
    const call = src.indexOf('await fetchSellerPaymentReadiness(');
    expect(src.indexOf("'VERIFIED'")).toBeLessThan(call);
    expect(call).toBeLessThan(src.indexOf('addItem(product)'));
  });

  it('product screen keeps the normal button and opens a dialog per state', () => {
    const src = read('app/product/[id].tsx');
    expect(src).not.toContain('sellerNotReadyBtn');
    expect(src).toContain('PurchaseProgressSteps');
    expect(src).toContain('purchaseDialogContent');
  });

  it('usePaymentProcess uses an i18n key for SELLER_NOT_ONBOARDED', () => {
    const src = read('core/hooks/usePaymentProcess.ts');
    expect(src).not.toContain('Seller onboarding is required');
    expect(src).toContain("t('payment.sellerNotReadyError')");
  });

  it('payment screen uses the readiness hook', () => {
    expect(read('app/checkout/payment.tsx')).toContain(
      'useSellerPaymentReadiness',
    );
  });

  it('new strings exist in en and es', () => {
    for (const lang of ['en', 'es']) {
      const product = JSON.parse(
        read(`core/i18n/locales/${lang}/product.json`),
      );
      const checkout = JSON.parse(
        read(`core/i18n/locales/${lang}/checkout.json`),
      );
      expect(product.dialogs.sellerNotReadyTitle).toBeString();
      expect(product.actions.sellerNotReadyBtn).toBeUndefined();
      expect(product.actions.sellerNotReadyTitle).toBeUndefined();
      expect(product.actions.sellerNotReadyMsg).toBeUndefined();
      expect(checkout.payment.sellerNotReadyError).toBeString();
    }
  });
});
