import { expect, it, mock } from 'bun:test';

// Keep the query and Supabase mocks out of the shared Bun module cache.
if (process.env.MONEY_CENTS_READS_CHILD !== '1') {
  it('checks the admin money reads in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { MONEY_CENTS_READS_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  type Response = {
    data: unknown;
    error: { message: string } | null;
    count?: number | null;
  };
  type Call = { table: string; select?: string; order: unknown[][] };

  // The money columns were renamed to integer cents; PostgREST rejects the
  // old names at runtime, which typecheck does not see in string selects.
  const PESOS_COLUMN =
    /\b(total_amount|service_fee_amount|price_at_purchase|price)\b/;

  let calls: Call[] = [];
  let rows: Record<string, unknown> = {};

  function builder(table: string) {
    const call: Call = { table, order: [] };
    calls.push(call);
    const respond = (): Response => {
      const names = [call.select ?? '', ...call.order.map((o) => String(o[0]))];
      const stale = names.find((name) => PESOS_COLUMN.test(name));
      if (stale) {
        return {
          data: null,
          error: { message: `column does not exist: ${stale}` },
          count: null,
        };
      }
      const key = `${table}|${call.select}`;
      return { data: key in rows ? rows[key] : [], error: null, count: 0 };
    };
    const chain: Record<string, unknown> = {
      select: (columns: string) => {
        call.select = columns;
        return chain;
      },
      order: (...args: unknown[]) => {
        call.order.push(args);
        return chain;
      },
      then: (
        resolve: (value: Response) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(respond()).then(resolve, reject),
    };
    for (const method of [
      'eq',
      'neq',
      'in',
      'not',
      'gte',
      'lt',
      'or',
      'limit',
      'range',
      'single',
      'maybeSingle',
    ]) {
      chain[method] = () => chain;
    }
    return chain;
  }

  let queryFn: (context?: unknown) => Promise<unknown> = async () => undefined;
  mock.module('@tanstack/react-query', () => ({
    useQuery: (options: { queryFn: () => Promise<unknown> }) => {
      queryFn = options.queryFn;
      return {};
    },
    useInfiniteQuery: (options: {
      queryFn: (context: unknown) => Promise<unknown>;
    }) => {
      queryFn = options.queryFn;
      return {};
    },
    keepPreviousData: undefined,
    QueryClient: class {},
    useMutation: () => ({}),
    useQueryClient: () => ({}),
  }));
  mock.module('@/shared/lib/supabase', () => ({
    supabase: { from: (table: string) => builder(table) },
  }));
  mock.module('@/shared/store/use-auth-store', () => ({
    useAuthStore: () => ({
      user: { id: 'admin-1' },
      profile: { role: 'admin' },
      initialized: true,
    }),
  }));

  const { useAdminStats } =
    await import('@/features/home/hooks/use-admin-stats');
  const { useActiveDisputes } =
    await import('@/features/disputes/hooks/use-active-disputes');
  const { useUserDetail } =
    await import('@/features/users/hooks/use-user-detail');
  const { usePendingProducts } =
    await import('@/features/verify/hooks/use-pending-products');
  const { useAdminProduct } =
    await import('@/features/products/hooks/use-admin-product');

  async function run(hook: () => unknown, data: Record<string, unknown>) {
    calls = [];
    rows = data;
    hook();
    return queryFn({ pageParam: 0 });
  }

  it('sums the dashboard money in integer cents', async () => {
    const stats = (await run(useAdminStats, {
      'admin_connect_payout_release_view|release_amount_cents, is_eligible': [
        { release_amount_cents: 1000, is_eligible: true },
        { release_amount_cents: 2550, is_eligible: true },
        { release_amount_cents: 999, is_eligible: false },
      ],
      'orders|total_amount_cents, service_fee_amount_cents': [
        { total_amount_cents: 123456, service_fee_amount_cents: 6001 },
        { total_amount_cents: 100001, service_fee_amount_cents: 2000 },
      ],
      'orders|total_amount_cents': [{ total_amount_cents: 100000 }],
    })) as Record<string, unknown>;

    expect(stats).toMatchObject({
      totalToPayCents: 3550,
      monthlyGmvCents: 223457,
      monthlyRevenueCents: 8001,
      monthlySalesCount: 2,
      averageTicketCents: 111729,
    });
    expect(Number.isInteger(stats.averageTicketCents)).toBe(true);
    expect(stats.trends).toMatchObject({
      monthlyGmv: { direction: 'up', percentage: 123 },
    });
  });

  it('sorts disputes by the order total in cents', async () => {
    await run(() => useActiveDisputes('open', '', 'amount_desc'), {});
    expect(calls[0]?.order).toEqual([
      ['total_amount_cents', { ascending: false }],
    ]);

    await run(() => useActiveDisputes('open', '', 'amount_asc'), {});
    expect(calls[0]?.order).toEqual([
      ['total_amount_cents', { ascending: true }],
    ]);
  });

  it('reads the user purchases and sales volume in cents', async () => {
    const detail = (await run(() => useUserDetail('user-1'), {
      'admin_user_directory_view|*': { id: 'user-1' },
      'order_items|price_at_purchase_cents, orders!inner(status)': [
        { price_at_purchase_cents: 123456, orders: { status: 'completed' } },
        { price_at_purchase_cents: 1, orders: { status: 'completed' } },
      ],
    })) as { metrics: Record<string, unknown> };

    expect(detail.metrics).toMatchObject({ totalVolumeCents: 123457 });
    expect(calls.map((call) => call.select)).toContain(
      '*, product:products(name, images, price_cents), orders!inner(status, buyer_id, created_at)',
    );
  });

  it('reads the pending products price in cents', async () => {
    const products = (await run(usePendingProducts, {})) as unknown[];
    const select = calls.find(
      (call) => call.table === 'admin_product_queue_view',
    )?.select;

    expect(products).toEqual([]);
    expect(select).toContain(' price_cents,');
    expect(PESOS_COLUMN.test(select ?? '')).toBe(false);
  });

  // The verification attempt keeps the lock, proofs and rejection note (#651);
  // the products columns that held them are dropped.
  const DROPPED_PRODUCT_COLUMN =
    /\b(verification_data|rejection_reason|verified_at|locked_by|locked_at)\b|products_locked_by_fkey/;

  it('reads the verification queue from the open attempts', async () => {
    const queueSelect =
      'id, name, price_cents, category, condition, images, description, specifications, status, created_at, seller_id, aspect_ratio, views, verification_id, submitted_at, benchmark_score, locked_by, locked_at, last_rejection_note, evidence, seller:profiles!products_seller_id_fkey(username, avatar_url, id, is_verified_seller)';
    const evidence = [
      { kind: 'performance', storage_path: 'p1/bench.png' },
      { kind: 'physical', storage_path: 'p1/paper.png' },
    ];
    const products = (await run(usePendingProducts, {
      [`admin_product_queue_view|${queueSelect}`]: [
        {
          id: 'p1',
          seller_id: 's1',
          last_rejection_note: 'Falta el papel con tu usuario',
          evidence,
        },
      ],
    })) as Array<Record<string, unknown>>;

    expect(calls.map((call) => call.table)).toEqual([
      'admin_product_queue_view',
      'seller_trust_stats',
      'admin_user_notes',
    ]);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      id: 'p1',
      last_rejection_note: 'Falta el papel con tu usuario',
      evidence,
    });
  });

  it('lists managed products without the dropped verification columns', async () => {
    await run(() => useAdminProduct('active', ''), {});
    const select = calls.find((call) => call.table === 'products')?.select;

    expect(select).toContain('seller:profiles!products_seller_id_fkey');
    expect(DROPPED_PRODUCT_COLUMN.test(select ?? '')).toBe(false);
  });
}
