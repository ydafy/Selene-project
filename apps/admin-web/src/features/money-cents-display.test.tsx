import { expect, it, mock } from 'bun:test';

// Keep the hook and Supabase mocks out of the shared Bun module cache.
if (process.env.MONEY_CENTS_DISPLAY_CHILD !== '1') {
  it('checks the admin money displays in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { MONEY_CENTS_DISPLAY_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MemoryRouter } = await import('react-router-dom');

  // Every amount below is integer cents; the screens show pesos with cents.
  const DISPLAY = '$1,234.56';
  const CENTS = 123456;

  mock.module('@/shared/lib/supabase', () => ({
    supabase: {
      storage: {
        from: () => ({ createSignedUrl: async () => ({ data: null }) }),
      },
    },
  }));
  mock.module('@/features/home/hooks/use-admin-stats', () => ({
    useAdminStats: () => ({
      data: {
        pendingProducts: 0,
        activeDisputes: 0,
        totalToPayCents: 100055,
        monthlyGmvCents: 223457,
        monthlyRevenueCents: 8001,
        monthlySalesCount: 2,
        averageTicketCents: 111729,
        trends: {
          pendingProducts: null,
          activeDisputes: null,
          monthlySales: null,
          monthlyGmv: null,
        },
        totalUsers: 0,
        totalProducts: 0,
        verifiedProducts: 0,
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: () => undefined,
    }),
  }));
  mock.module('@/features/home/components/activity-feed', () => ({
    ActivityFeed: () => null,
  }));
  mock.module('@/features/home/components/catalog-health-card', () => ({
    CatalogHealthCard: () => null,
  }));
  mock.module('@/features/products/hooks/use-admin-product', () => ({
    useAdminProduct: () => ({
      products: [
        {
          id: 'product-1',
          name: 'RTX 4070',
          price_cents: CENTS,
          status: 'VERIFIED',
          category: 'GPU',
          condition: 'used',
          created_at: '2026-11-13T00:00:00.000Z',
          deleted_at: null,
          locked_by: null,
          seller_id: 'seller-1',
          seller: { username: 'seller' },
          locker: null,
        },
      ],
      total: 1,
      isLoading: false,
      isError: false,
      refetch: () => undefined,
      fetchNextPage: () => undefined,
      hasNextPage: false,
      isFetchingNextPage: false,
      softDelete: async () => undefined,
      isDeleting: false,
      restoreProduct: async () => undefined,
      isRestoring: false,
    }),
  }));
  mock.module('@/features/products/hooks/use-admin-product-counts', () => ({
    useAdminProductCounts: () => ({ active: 1, history: 0 }),
  }));

  const { DisputesTable } =
    await import('@/features/disputes/components/disputes-table');
  const { InventoryTable } =
    await import('@/features/users/components/inventory-table');
  const { PurchasesTable } =
    await import('@/features/users/components/purchases-table');
  const { VerificationList } =
    await import('@/features/verify/components/verification-list');
  const { DashboardHome } =
    await import('@/features/home/screens/dashboard-home-screen');
  const { ProductManagementPage } =
    await import('@/features/products/screens/product-management-screen');

  type Props<T> = T extends (props: infer P) => unknown ? P : never;

  it('shows the dispute order total from cents', () => {
    const disputes = [
      {
        dispute_id: 'dispute-1',
        order_id: 'order-1',
        total_amount_cents: CENTS,
      },
    ] as unknown as Props<typeof DisputesTable>['disputes'];
    const html = renderToStaticMarkup(
      <DisputesTable
        disputes={disputes}
        isLoading={false}
        onViewDetails={() => undefined}
      />,
    );
    expect(html).toContain(DISPLAY);
  });

  it('shows the inventory price from cents', () => {
    const products = [
      {
        id: 'product-1',
        name: 'RTX 4070',
        images: [],
        price_cents: CENTS,
        status: 'VERIFIED',
        created_at: '2026-11-13T00:00:00.000Z',
      },
    ] as unknown as Props<typeof InventoryTable>['products'];
    const html = renderToStaticMarkup(
      <InventoryTable products={products} total={1} />,
    );
    expect(html).toContain(DISPLAY);
  });

  it('shows the price paid from cents', () => {
    const items = [
      {
        id: 'item-1',
        price_at_purchase_cents: CENTS,
        created_at: '2026-11-13T00:00:00.000Z',
        product: { name: 'RTX 4070', images: [], price_cents: CENTS },
        orders: { status: 'completed' },
      },
    ] as unknown as Props<typeof PurchasesTable>['items'];
    const html = renderToStaticMarkup(<PurchasesTable items={items} />);
    expect(html).toContain(DISPLAY);
  });

  it('shows the pending product price from cents', () => {
    const products = [
      {
        id: 'product-1',
        name: 'RTX 4070',
        category: 'GPU',
        price_cents: CENTS,
        seller_id: 'seller-1',
        seller: { username: 'seller', avatar_url: null },
        created_at: '2026-11-13T00:00:00.000Z',
      },
    ] as unknown as Props<typeof VerificationList>['products'];
    const html = renderToStaticMarkup(
      <VerificationList
        products={products}
        selectedId={null}
        isLocking={false}
        onSelectProduct={() => undefined}
      />,
    );
    expect(html).toContain(DISPLAY);
  });

  it('shows the dashboard money from cents', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DashboardHome />
      </MemoryRouter>,
    );
    for (const value of ['$1,000.55', '$2,234.57', '$80.01', '$1,117.29']) {
      expect(html).toContain(value);
    }
  });

  it('shows the managed product price from cents', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProductManagementPage />
      </MemoryRouter>,
    );
    expect(html).toContain(DISPLAY);
  });
}
