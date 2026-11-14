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
      'single',
      'maybeSingle',
    ]) {
      chain[method] = () => chain;
    }
    return chain;
  }

  let queryFn: () => Promise<unknown> = async () => undefined;
  mock.module('@tanstack/react-query', () => ({
    useQuery: (options: { queryFn: () => Promise<unknown> }) => {
      queryFn = options.queryFn;
      return {};
    },
    useMutation: () => ({}),
    useQueryClient: () => ({}),
  }));
  mock.module('@/shared/lib/supabase', () => ({
    supabase: { from: (table: string) => builder(table) },
  }));

  const { useAdminStats } =
    await import('@/features/home/hooks/use-admin-stats');
  const { useActiveDisputes } =
    await import('@/features/disputes/hooks/use-active-disputes');
  const { useUserDetail } =
    await import('@/features/users/hooks/use-user-detail');
  const { usePendingProducts } =
    await import('@/features/verify/hooks/use-pending-products');

  async function run(hook: () => unknown, data: Record<string, unknown>) {
    calls = [];
    rows = data;
    hook();
    return queryFn();
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
    const select = calls.find((call) => call.table === 'products')?.select;

    expect(products).toEqual([]);
    expect(select).toContain(' price_cents,');
    expect(PESOS_COLUMN.test(select ?? '')).toBe(false);
  });
}
