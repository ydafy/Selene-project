import { describe, expect, test } from 'bun:test';

import { insertAddress, PendingAddress } from './use-addresses.helpers';

type Call =
  | { op: 'update'; values: unknown; filters: [string, unknown][] }
  | { op: 'insert'; values: Record<string, unknown> };

const fakeClient = (options: { clearError?: unknown } = {}) => {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      expect(table).toBe('addresses');
      return {
        update: (values: unknown) => {
          const call: Call = { op: 'update', values, filters: [] };
          calls.push(call);
          const builder = {
            eq: (column: string, value: unknown) => {
              call.filters.push([column, value]);
              return builder;
            },
            then: (resolve: (r: { error: unknown }) => unknown) =>
              resolve({ error: options.clearError ?? null }),
          };
          return builder;
        },
        insert: (values: Record<string, unknown>) => {
          calls.push({ op: 'insert', values });
          return {
            select: () => ({
              single: async () => ({
                data: { id: 'address-new', ...values },
                error: null,
              }),
            }),
          };
        },
      };
    },
  };
  return { client: client as never, calls };
};

const pending = (isDefault: boolean) =>
  ({
    label: 'Home',
    full_name: 'Buyer',
    phone: '5512345678',
    street_line1: 'Calle 1',
    street_number: '10',
    city: 'CDMX',
    state: 'CMX',
    zip_code: '06600',
    country: 'MX',
    is_default: isDefault,
  }) as unknown as PendingAddress;

describe('insertAddress', () => {
  test('clears the current default before inserting a new default address', async () => {
    const { client, calls } = fakeClient();

    await insertAddress(client, 'user-1', pending(true), false);

    expect(calls.map((c) => c.op)).toEqual(['update', 'insert']);
    expect(calls[0]).toEqual({
      op: 'update',
      values: { is_default: false },
      filters: [
        ['user_id', 'user-1'],
        ['is_default', true],
      ],
    });
    expect(calls[1]).toMatchObject({
      op: 'insert',
      values: { user_id: 'user-1', is_default: true },
    });
  });

  test('inserts a non-default address without touching the current default', async () => {
    const { client, calls } = fakeClient();

    const data = await insertAddress(client, 'user-1', pending(false), false);

    expect(calls.map((c) => c.op)).toEqual(['insert']);
    expect(calls[0]).toMatchObject({ values: { is_default: false } });
    expect(data).toMatchObject({ id: 'address-new' });
  });

  test('makes the first address the default', async () => {
    const { client, calls } = fakeClient();

    await insertAddress(client, 'user-1', pending(false), true);

    expect(calls.at(-1)).toMatchObject({
      op: 'insert',
      values: { is_default: true },
    });
  });

  test('does not insert when clearing the current default fails', async () => {
    const clearError = { code: '42501', message: 'denied' };
    const { client, calls } = fakeClient({ clearError });

    await expect(
      insertAddress(client, 'user-1', pending(true), false),
    ).rejects.toBe(clearError);
    expect(calls.map((c) => c.op)).toEqual(['update']);
  });
});
