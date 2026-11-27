import { beforeEach, expect, it, mock } from 'bun:test';
import type { PendingProduct } from '@selene/types';

// Keep query and provider mocks out of the shared Bun module cache.
if (process.env.PENDING_PRODUCTS_HOOK_CHILD !== '1') {
  it('checks the pending products hook in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { PENDING_PRODUCTS_HOOK_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  type MutationOptions = {
    mutationFn: (input: unknown) => Promise<unknown>;
    onSuccess?: (result: unknown) => Promise<void> | void;
    onError?: (error: unknown) => Promise<void> | void;
  };
  type RpcResult = { data: unknown; error: { message: string } | null };
  const rpcCalls: Array<[string, unknown]> = [];
  const invalidations: unknown[] = [];
  const toasts: Array<[string, string]> = [];
  let rpcResult: RpcResult;

  mock.module('@tanstack/react-query', () => ({
    useQuery: () => ({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: async () => undefined,
    }),
    useMutation: (options: MutationOptions) => ({
      isPending: false,
      mutateAsync: async (input: unknown) => {
        try {
          const result = await options.mutationFn(input);
          await options.onSuccess?.(result);
          return result;
        } catch (error) {
          await options.onError?.(error);
          throw error;
        }
      },
    }),
    useQueryClient: () => ({
      invalidateQueries: async (filters: unknown) => {
        invalidations.push(filters);
      },
    }),
  }));
  mock.module('sonner', () => ({
    toast: {
      success: (message: string) => toasts.push(['success', message]),
      error: (message: string) => toasts.push(['error', message]),
    },
  }));
  mock.module('@/shared/lib/supabase', () => ({
    supabase: {
      rpc: async (name: string, args: unknown) => {
        rpcCalls.push([name, args]);
        return rpcResult;
      },
    },
  }));

  const { usePendingProducts } = await import('./use-pending-products');
  const { VERIFICATION_NOT_OPEN_MESSAGE } =
    await import('../logic/resolve-verdict');

  const product = {
    id: 'product-1',
    verification_id: 'attempt-1',
  } as PendingProduct;
  const queue = { queryKey: ['pending-products'] };

  beforeEach(() => {
    rpcCalls.length = 0;
    invalidations.length = 0;
    toasts.length = 0;
    rpcResult = { data: true, error: null };
  });

  it('decides the attempt shown in the queue with the exact payload', async () => {
    const { resolve } = usePendingProducts();
    await resolve.mutateAsync({
      id: 'product-1',
      verdict: 'REJECT',
      note: '  Serial number missing  ',
      product,
    });
    expect(rpcCalls).toEqual([
      [
        'fn_resolve_product_verdict',
        {
          p_product_id: 'product-1',
          p_verification_id: 'attempt-1',
          p_verdict: 'REJECT',
          p_public_note: 'Serial number missing',
          p_private_note: undefined,
        },
      ],
    ]);
    expect(invalidations).toEqual([queue, { queryKey: ['admin-stats'] }]);
    expect(toasts).toEqual([['success', 'Veredicto enviado correctamente']]);
  });

  it('refreshes the queue and says the attempt was handled when it is no longer open', async () => {
    rpcResult = { data: null, error: { message: 'VERIFICATION_NOT_OPEN' } };
    const { resolve } = usePendingProducts();
    await expect(
      resolve.mutateAsync({ id: 'product-1', verdict: 'APPROVE', product }),
    ).rejects.toThrow(VERIFICATION_NOT_OPEN_MESSAGE);
    expect(invalidations).toEqual([queue]);
    expect(toasts).toEqual([
      ['error', `Error: ${VERIFICATION_NOT_OPEN_MESSAGE}`],
    ]);
  });

  it('still explains a lost lock without refreshing the queue', async () => {
    rpcResult = { data: null, error: { message: 'LOCK_EXPIRED_OR_STOLEN' } };
    const { resolve } = usePendingProducts();
    await expect(
      resolve.mutateAsync({ id: 'product-1', verdict: 'APPROVE', product }),
    ).rejects.toThrow(
      'Tu sesión de revisión expiró o el producto fue bloqueado por otro administrador.',
    );
    expect(invalidations).toEqual([]);
    expect(toasts).toEqual([
      [
        'error',
        'Error: Tu sesión de revisión expiró o el producto fue bloqueado por otro administrador.',
      ],
    ]);
  });
}
