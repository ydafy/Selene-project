import { beforeEach, describe, expect, it, mock } from 'bun:test';

const calls: Array<[string, unknown[]]> = [];
let result: { data: unknown; error: unknown } = { data: {}, error: null };

const builder = {
  select: (...args: unknown[]) => {
    calls.push(['select', args]);
    return builder;
  },
  eq: (...args: unknown[]) => {
    calls.push(['eq', args]);
    return builder;
  },
  single: async () => {
    calls.push(['single', []]);
    return result;
  },
};

mock.module('@/shared/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      calls.push(['from', [table]]);
      return builder;
    },
  },
}));

let queryOptions: { queryKey: unknown; queryFn: () => Promise<unknown> };

// Bun module mocks are process-wide: keep the real exports so later test files that
// import useQueryClient (or anything else) still find them.
const reactQuery = await import('@tanstack/react-query');
mock.module('@tanstack/react-query', () => ({
  ...reactQuery,
  useQuery: (options: typeof queryOptions) => {
    queryOptions = options;
    return { data: undefined };
  },
}));

const { useSystemConfig } = await import('./use-system-config');

beforeEach(() => {
  calls.length = 0;
  result = { data: {}, error: null };
});

describe('useSystemConfig', () => {
  it('selects only the system_settings columns clients are granted', async () => {
    useSystemConfig();
    await queryOptions.queryFn();

    // Must match the column grants in supabase/schemas/public/tables/system_settings.sql;
    // anon and authenticated cannot select any other column (#305).
    expect(calls).toEqual([
      ['from', ['system_settings']],
      [
        'select',
        [
          'id, is_maintenance, min_version_android, min_version_ios, service_fee_pct, insurance_rate, shipping_buffer_cents, package_presets, order_expiration_hours, preparing_expiration_hours',
        ],
      ],
      ['eq', ['id', 1]],
      ['single', []],
    ]);
  });

  it('throws the query error', async () => {
    const error = { message: 'permission denied', code: '42501' };
    result = { data: null, error };
    useSystemConfig();
    await expect(queryOptions.queryFn()).rejects.toBe(error);
  });
});
