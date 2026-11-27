import { beforeEach, expect, it, mock } from 'bun:test';

// Keep react, query and provider mocks out of the shared Bun module cache.
if (process.env.PRODUCT_LOCK_HOOK_CHILD !== '1') {
  it('checks the product lock hook in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { PRODUCT_LOCK_HOOK_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  type RpcResult = { data: unknown; error: { message: string } | null };
  const rpcCalls: Array<[string, unknown]> = [];
  const invalidations: unknown[] = [];
  const toasts: Array<[string, string]> = [];
  let rpcResult: RpcResult;

  mock.module('react', () => ({
    useState: <T>(initial: T) => [initial, () => undefined],
    useCallback: <T>(fn: T) => fn,
    useRef: <T>(initial: T) => ({ current: initial }),
  }));
  mock.module('@tanstack/react-query', () => ({
    useQueryClient: () => ({
      invalidateQueries: async (filters: unknown) => {
        invalidations.push(filters);
      },
    }),
  }));
  mock.module('sonner', () => ({
    toast: {
      warning: (message: string) => toasts.push(['warning', message]),
      error: (message: string) => toasts.push(['error', message]),
    },
  }));
  mock.module('@/shared/store/use-auth-store', () => ({
    useAuthStore: () => ({ user: { id: 'admin-1' } }),
  }));
  mock.module('@/shared/lib/supabase', () => ({
    supabase: {
      rpc: async (name: string, args: unknown) => {
        rpcCalls.push([name, args]);
        return rpcResult;
      },
    },
  }));

  const { useProductLock } = await import('./use-product-lock');
  const { VERIFICATION_NOT_OPEN_MESSAGE } =
    await import('../logic/resolve-verdict');

  beforeEach(() => {
    rpcCalls.length = 0;
    invalidations.length = 0;
    toasts.length = 0;
    rpcResult = {
      data: [{ success: true, locked_by_username: null, locked_at: null }],
      error: null,
    };
  });

  it('locks the attempt shown in the queue, naming the listing and the attempt', async () => {
    const { acquireLock } = useProductLock();
    expect(await acquireLock('product-1', 'attempt-1')).toBe(true);
    expect(rpcCalls).toEqual([
      [
        'fn_lock_product',
        { p_product_id: 'product-1', p_verification_id: 'attempt-1' },
      ],
    ]);
    expect(invalidations).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it('refreshes the queue and says the attempt was handled when it is no longer open', async () => {
    rpcResult = {
      data: null,
      error: { message: 'VERIFICATION_NOT_OPEN' },
    };
    const { acquireLock } = useProductLock();
    expect(await acquireLock('product-1', 'attempt-1')).toBe(false);
    expect(invalidations).toEqual([{ queryKey: ['pending-products'] }]);
    expect(toasts).toEqual([['warning', VERIFICATION_NOT_OPEN_MESSAGE]]);
  });

  it('still reports a lock held by another admin without refreshing', async () => {
    rpcResult = {
      data: [
        {
          success: false,
          locked_by_username: 'otro_admin',
          locked_at: '2026-11-26T10:00:00Z',
        },
      ],
      error: null,
    };
    const { acquireLock } = useProductLock();
    expect(await acquireLock('product-1', 'attempt-1')).toBe(false);
    expect(invalidations).toEqual([]);
    expect(toasts).toEqual([
      ['warning', 'Acceso denegado: Producto en revisión por otro_admin'],
    ]);
  });

  it('still reports any other error as a connection error without refreshing', async () => {
    rpcResult = { data: null, error: { message: 'UNAUTHORIZED_ADMIN_ONLY' } };
    const { acquireLock } = useProductLock();
    expect(await acquireLock('product-1', 'attempt-1')).toBe(false);
    expect(invalidations).toEqual([]);
    expect(toasts).toEqual([
      ['error', 'Error de conexión: UNAUTHORIZED_ADMIN_ONLY'],
    ]);
  });
}
