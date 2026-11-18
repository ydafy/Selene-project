import { expect, it, mock } from 'bun:test';

// Keep the query and Supabase mocks out of the shared Bun module cache.
if (process.env.USER_DETAIL_REPORTS_CHILD !== '1') {
  it('checks the user detail reports query in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { USER_DETAIL_REPORTS_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  type Call = {
    table: string;
    select?: string;
    selectOptions?: unknown;
    filters: unknown[][];
  };
  let calls: Call[] = [];

  const reportRow = {
    id: 'report-1',
    created_at: '2026-11-17T10:00:00.000Z',
    reason: 'fraud',
    details: 'Pidió el pago fuera de la app',
    status: 'open',
    outcome: null,
    resolved_at: null,
    reporter: { username: 'compradora' },
  };

  function builder(table: string) {
    const call: Call = { table, filters: [] };
    calls.push(call);
    // PostgREST returns a count only when the select asks for one.
    const respond = () =>
      table === 'reports'
        ? {
            data: [reportRow],
            error: null,
            count:
              (call.selectOptions as { count?: string } | undefined)?.count ===
              'exact'
                ? 23
                : null,
          }
        : table === 'admin_user_directory_view'
          ? { data: { id: 'user-1' }, error: null, count: null }
          : { data: [], error: null, count: 0 };
    const chain: Record<string, unknown> = {
      select: (columns: string, options?: unknown) => {
        call.select = columns;
        call.selectOptions = options;
        return chain;
      },
      then: (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(respond()).then(resolve, reject),
    };
    for (const method of [
      'eq',
      'neq',
      'or',
      'order',
      'limit',
      'single',
      'maybeSingle',
    ]) {
      chain[method] = (...args: unknown[]) => {
        call.filters.push([method, ...args]);
        return chain;
      };
    }
    return chain;
  }

  let queryFn: () => Promise<unknown> = async () => undefined;
  mock.module('@tanstack/react-query', () => ({
    useQuery: (options: { queryFn: () => Promise<unknown> }) => {
      queryFn = options.queryFn;
      return {};
    },
  }));
  mock.module('@/shared/lib/supabase', () => ({
    supabase: { from: (table: string) => builder(table) },
  }));

  const { useUserDetail } = await import('./use-user-detail');

  async function load(hook: () => unknown) {
    calls = [];
    hook();
    const detail = (await queryFn()) as Record<string, unknown>;
    const reports = calls.filter((c) => c.table === 'reports');
    expect(reports).toHaveLength(1);
    return { detail, call: reports[0] };
  }

  it('reads the reports against this user by target_user_id', async () => {
    const { call } = await load(() => useUserDetail('user-1'));
    expect(call.filters).toContainEqual(['eq', 'target_user_id', 'user-1']);
    expect(
      call.filters.some((f) => f[0] === 'eq' && f[1] === 'target_id'),
    ).toBe(false);
    expect(call.filters).toContainEqual([
      'order',
      'created_at',
      { ascending: false },
    ]);
    expect(call.filters).toContainEqual(['limit', 20]);
  });

  it('selects explicit report columns and the reporter username', async () => {
    const { call } = await load(() => useUserDetail('user-1'));
    const columns = (call.select ?? '').replace(/\s+/g, '');
    expect(columns).toBe(
      'id,created_at,reason,details,status,outcome,resolved_at,reporter:profiles!reporter_id(username)',
    );
    expect(columns).not.toContain('*');
    expect(call.selectOptions).toEqual({ count: 'exact' });
  });

  it('returns the listed reports and the total count', async () => {
    const { detail } = await load(() => useUserDetail('user-1'));
    expect(detail.reports).toEqual([reportRow]);
    expect(detail.reportsCount).toBe(23);
  });
}
