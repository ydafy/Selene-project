import { expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// mock.module leaks across files, so the mount test runs in its own process.
if (process.env.SELENE_CART_VALIDATION_CHILD !== '1') {
  test('cart validation asks the injected check about the cart ids', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_CART_VALIDATION_CHILD: '1' },
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
      join(import.meta.dir, 'use-cart-validation.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /(?:from\s+|import\(\s*|require\(\s*)['"][^'"]*features\//,
    );
    expect(source).not.toMatch(/from\s+['"]\.\.\/\.\.\/(?!\.\.\/|cart\/)/);
  });

  // Routes compose features (L4, decision C): the cart route hands the hook the
  // orders feature's stock check.
  test('the cart route passes the orders stock check to the hook', () => {
    const route = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'app', '(tabs)', 'cart.tsx'),
      'utf8',
    );
    expect(route).toMatch(
      /const validateProductStock = \(productIds: string\[\]\) =>\s*OrderService\.validateProductStock\(productIds\);/,
    );
    expect(route).toContain('useCartValidation(validateProductStock)');
  });
} else {
  const cart = { items: [] as { id: string }[] };

  mock.module('react-native', () => ({
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
  }));
  mock.module('../../../shared/store/use-cart-store', () => ({
    useCartStore: (select: (state: typeof cart) => unknown) => select(cart),
  }));

  const { renderHook, waitFor } = await import('@testing-library/react-native');
  const { useCartValidation } = await import('./use-cart-validation');

  type Check = Parameters<typeof useCartValidation>[0];
  type Outcome = Awaited<ReturnType<Check>>;

  const mountHook = async (validateProductStock: Check) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return renderHook(() => useCartValidation(validateProductStock), {
      wrapper,
    });
  };

  const setCart = (ids: string[]) => {
    cart.items = ids.map((id) => ({ id }));
  };

  test('an empty cart never asks the check', async () => {
    setCart([]);
    const check = mock<Check>(async () => ({ unavailableIds: [] }));
    const { result } = await mountHook(check);
    expect(check).not.toHaveBeenCalled();
    expect(result.current.unavailableIds.size).toBe(0);
    expect(result.current.hasUnavailableItems).toBe(false);
  });

  test('the check receives every cart id in cart order and marks the unavailable ones', async () => {
    setCart(['a', 'b', 'c']);
    const outcome: Outcome = { unavailableIds: ['b', 'c'] };
    const check = mock<Check>(async () => outcome);
    const { result } = await mountHook(check);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(check.mock.calls).toEqual([[['a', 'b', 'c']]]);
    expect([...result.current.unavailableIds]).toEqual(['b', 'c']);
    expect(result.current.hasUnavailableItems).toBe(true);
  });

  test('a cart where everything is available has no unavailable items', async () => {
    setCart(['a']);
    const check = mock<Check>(async () => ({ unavailableIds: [] }));
    const { result } = await mountHook(check);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.unavailableIds.size).toBe(0);
    expect(result.current.hasUnavailableItems).toBe(false);
  });

  test('a failed check leaves the cart without unavailable items', async () => {
    setCart(['a']);
    const check = mock<Check>(async () => {
      throw new Error('network down');
    });
    const { result } = await mountHook(check);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.unavailableIds.size).toBe(0);
    expect(result.current.hasUnavailableItems).toBe(false);
  });
}
