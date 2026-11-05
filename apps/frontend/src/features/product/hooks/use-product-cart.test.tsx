import { expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// mock.module leaks across files, so the mount test runs in its own process.
if (process.env.SELENE_PRODUCT_CART_CHILD !== '1') {
  test('add to cart decides from the fresh status and the injected seller check', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_PRODUCT_CART_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (child.exitCode !== 0)
      throw new Error(
        new TextDecoder().decode(child.stdout) +
          new TextDecoder().decode(child.stderr),
      );
    expect(child.exitCode).toBe(0);
  });

  test('the hook imports no other feature', () => {
    const source = readFileSync(
      join(import.meta.dir, 'use-product-cart.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /(?:from\s+|import\(\s*|require\(\s*)['"][^'"]*features\//,
    );
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/(?!\.\.\/|product\/)/);
  });
} else {
  const db = { status: 'VERIFIED', error: null as unknown };
  const addItem = mock<(product: unknown) => void>(() => {});
  const toasts: unknown[] = [];

  const query = {
    select: () => query,
    eq: () => query,
    single: async () => ({
      data: db.error ? null : { status: db.status },
      error: db.error,
    }),
  };

  mock.module('react-native', () => ({
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
  }));
  mock.module('react-native-toast-message', () => ({
    default: { show: (toast: unknown) => toasts.push(toast) },
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
  }));
  mock.module('@tanstack/react-query', () => ({
    useQueryClient: () => ({ setQueriesData: () => {} }),
  }));
  mock.module('../../../shared/lib/supabase', () => ({
    supabase: { from: () => query },
  }));
  mock.module('../../../shared/store/use-cart-store', () => ({
    useCartStore: () => ({ addItem, isInCart: () => false }),
  }));

  const { act, renderHook } = await import('@testing-library/react-native');
  const { useProductCart } = await import('./use-product-cart');

  const product = { id: 'product-1', name: 'RTX 4070' } as never;

  const press = async (
    checkSellerBlocked: (id: string) => Promise<boolean>,
  ) => {
    const { result } = await renderHook(() =>
      useProductCart(product, checkSellerBlocked),
    );
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.handleAddToCart();
    });
    return { outcome, isAddingToCart: result.current.isAddingToCart };
  };

  const reset = (status: string, error: unknown = null) => {
    db.status = status;
    db.error = error;
    addItem.mockClear();
    toasts.length = 0;
  };

  test('a verified listing from a ready seller is added to the cart', async () => {
    reset('VERIFIED');
    const check = mock<(id: string) => Promise<boolean>>(async () => false);
    const { outcome, isAddingToCart } = await press(check);
    expect(outcome).toBe('SUCCESS');
    expect(isAddingToCart).toBe(false);
    expect(check.mock.calls).toEqual([['product-1']]);
    expect(addItem.mock.calls).toEqual([[product]]);
  });

  test('a verified listing from a seller that cannot take payments opens the seller dialog', async () => {
    reset('VERIFIED');
    const check = mock<(id: string) => Promise<boolean>>(async () => true);
    const { outcome, isAddingToCart } = await press(check);
    expect(outcome).toBe('SELLER_NOT_READY');
    expect(isAddingToCart).toBe(false);
    expect(check.mock.calls).toEqual([['product-1']]);
    expect(addItem).not.toHaveBeenCalled();
  });

  test.each(['PENDING_VERIFICATION', 'IN_REVIEW'])(
    'a %s listing opens its dialog without asking about the seller',
    async (status) => {
      reset(status);
      const check = mock<(id: string) => Promise<boolean>>(async () => true);
      const { outcome } = await press(check);
      expect(outcome).toBe(status);
      expect(check).not.toHaveBeenCalled();
      expect(addItem).not.toHaveBeenCalled();
    },
  );

  test('an unavailable listing shows the not available toast', async () => {
    reset('SOLD');
    const check = mock<(id: string) => Promise<boolean>>(async () => false);
    const { outcome } = await press(check);
    expect(outcome).toBe('UNAVAILABLE');
    expect(check).not.toHaveBeenCalled();
    expect(addItem).not.toHaveBeenCalled();
    expect(toasts).toEqual([
      {
        type: 'error',
        text1: 'product:actions.notAvailable',
        text2: 'product:actions.notAvailableMsg',
      },
    ]);
  });

  test('a failed status read reports an error and adds nothing', async () => {
    const log = console.error;
    console.error = () => {};
    try {
      reset('VERIFIED', new Error('boom'));
      const check = mock<(id: string) => Promise<boolean>>(async () => false);
      const { outcome, isAddingToCart } = await press(check);
      expect(outcome).toBe('ERROR');
      expect(isAddingToCart).toBe(false);
      expect(check).not.toHaveBeenCalled();
      expect(addItem).not.toHaveBeenCalled();
    } finally {
      console.error = log;
    }
  });
}
