import { describe, expect, it } from 'bun:test';

import {
  MAX_AVATAR_PAGES,
  STORAGE_PAGE_SIZE,
  createSupabaseClosurePorts,
  ownProductPath,
  parseClosureCleanup,
  removeAvatarFolder,
  removeListingImages,
  runClosureCleanup,
  safeErrorCode,
  type ClosureCleanup,
  type ClosureCleanupPorts,
  type ClosureCleanupUpdate,
} from './account-closure-cleanup.ts';

const USER = '00000000-0000-4000-8000-0000000000aa';
const CUSTOMER = 'cus_test_123';
const ACCOUNT = 'acct_test_123';

const pending = (overrides: Partial<ClosureCleanup> = {}): ClosureCleanup => ({
  customerId: CUSTOMER,
  accountId: ACCOUNT,
  customerCleanup: 'pending',
  accountCleanup: 'pending',
  storageCleanup: 'pending',
  ...overrides,
});

function stripeError(code: string) {
  return Object.assign(new Error('You cannot delete acct_test_123 for jane@example.com'), { code });
}

function ports(overrides: { customer?: Error; account?: Error; storage?: Error; record?: Error } = {}) {
  const calls = { customer: [] as string[], account: [] as string[], storage: [] as string[] };
  const records: ClosureCleanupUpdate[] = [];
  const logs: { level: string; msg: string; data?: Record<string, unknown> }[] = [];
  const value: ClosureCleanupPorts = {
    deleteStripeCustomer: async (id) => {
      calls.customer.push(id);
      if (overrides.customer) throw overrides.customer;
    },
    deleteStripeAccount: async (id) => {
      calls.account.push(id);
      if (overrides.account) throw overrides.account;
    },
    removeStorageFiles: async (userId) => {
      calls.storage.push(userId);
      if (overrides.storage) throw overrides.storage;
    },
    recordCleanup: async (_userId, update) => {
      records.push(update);
      if (overrides.record) throw overrides.record;
    },
    log: (level, msg, data) => {
      logs.push({ level, msg, data });
    },
  };
  return { value, calls, records, logs };
}

describe('safeErrorCode', () => {
  it('keeps a lowercase snake_case code and hides everything else', () => {
    expect(safeErrorCode(stripeError('balance_insufficient'))).toBe('balance_insufficient');
    expect(safeErrorCode(stripeError('Has Spaces jane@example.com'))).toBe('error');
    expect(safeErrorCode(new Error('plain'))).toBe('error');
    expect(safeErrorCode(null)).toBe('error');
    expect(safeErrorCode('text')).toBe('error');
  });
});

describe('parseClosureCleanup', () => {
  const row = {
    stripe_customer_id: CUSTOMER,
    stripe_account_id: null,
    stripe_customer_cleanup: 'failed',
    stripe_account_cleanup: 'not_needed',
    storage_cleanup: 'pending',
  };

  it('reads the closure columns', () => {
    expect(parseClosureCleanup(row)).toEqual({
      customerId: CUSTOMER,
      accountId: null,
      customerCleanup: 'failed',
      accountCleanup: 'not_needed',
      storageCleanup: 'pending',
    });
  });

  it('rejects a row with a wrong shape', () => {
    expect(parseClosureCleanup({ ...row, storage_cleanup: 'weird' })).toBeNull();
    expect(parseClosureCleanup({ ...row, stripe_customer_id: 5 })).toBeNull();
    expect(parseClosureCleanup({})).toBeNull();
  });
});

describe('runClosureCleanup', () => {
  it('runs every pending step, records each and counts one attempt', async () => {
    const p = ports();
    const result = await runClosureCleanup(USER, pending(), p.value);
    expect(result).toEqual({ failures: [] });
    expect(p.calls).toEqual({ customer: [CUSTOMER], account: [ACCOUNT], storage: [USER] });
    expect(p.records).toEqual([
      { stripe_customer_cleanup: 'done' },
      { stripe_account_cleanup: 'done' },
      { storage_cleanup: 'done' },
      { attempt: true, last_error: null },
    ]);
  });

  it('stamps last_error without counting when the caller already counted the attempt', async () => {
    const p = ports({ storage: new Error('x') });
    const result = await runClosureCleanup(USER, pending(), p.value, { countAttempt: false });
    expect(result).toEqual({ failures: ['storage:error'] });
    expect(p.records.at(-1)).toEqual({ finish: true, last_error: 'storage:error' });
    expect(p.records.some((update) => 'attempt' in update)).toBe(false);
  });

  it('retries only steps still pending or failed', async () => {
    const p = ports();
    await runClosureCleanup(
      USER,
      pending({ customerCleanup: 'done', accountCleanup: 'failed', storageCleanup: 'not_needed' }),
      p.value,
    );
    expect(p.calls).toEqual({ customer: [], account: [ACCOUNT], storage: [] });
    expect(p.records).toEqual([{ stripe_account_cleanup: 'done' }, { attempt: true, last_error: null }]);
  });

  it('writes nothing when nothing is left', async () => {
    const p = ports();
    const result = await runClosureCleanup(
      USER,
      pending({ customerCleanup: 'done', accountCleanup: 'not_needed', storageCleanup: 'done' }),
      p.value,
    );
    expect(result).toEqual({ failures: [] });
    expect(p.records).toEqual([]);
  });

  it('treats resource_missing and account_invalid as gone, other codes as failures', async () => {
    const gone = ports({ customer: stripeError('resource_missing'), account: stripeError('account_invalid') });
    expect((await runClosureCleanup(USER, pending(), gone.value)).failures).toEqual([]);

    const balance = ports({ account: stripeError('balance_insufficient') });
    const result = await runClosureCleanup(USER, pending(), balance.value);
    expect(result.failures).toEqual(['stripe_account:balance_insufficient']);
    expect(balance.records).toContainEqual({ stripe_account_cleanup: 'failed' });
    // resource_missing is not "gone" for a Connect account.
    const missing = ports({ account: stripeError('resource_missing') });
    expect((await runClosureCleanup(USER, pending(), missing.value)).failures).toEqual([]);
  });

  it('marks a Stripe step not_needed when the closure holds no id', async () => {
    const p = ports();
    await runClosureCleanup(USER, pending({ customerId: null, accountId: null }), p.value);
    expect(p.calls.customer).toEqual([]);
    expect(p.calls.account).toEqual([]);
    expect(p.records.slice(0, 2)).toEqual([
      { stripe_customer_cleanup: 'not_needed' },
      { stripe_account_cleanup: 'not_needed' },
    ]);
  });

  it('survives a failing recorder and never logs raw messages', async () => {
    const p = ports({ record: new Error('duplicate key value violates constraint "secret_table_pkey"') });
    const result = await runClosureCleanup(USER, pending(), p.value);
    expect(result).toEqual({ failures: [] });
    expect(JSON.stringify(p.logs)).not.toContain('secret_table');
  });
});

describe('ownProductPath', () => {
  const base = 'https://x.supabase.co/storage/v1/object/public/products/';

  it('returns the path inside the user folder only', () => {
    expect(ownProductPath(`${base}${USER}/a%20b.jpg?t=1`, USER)).toBe(`${USER}/a b.jpg`);
    expect(ownProductPath(`${base}other/a.jpg`, USER)).toBeNull();
    expect(ownProductPath(`${base}${USER}/../other/a.jpg`, USER)).toBeNull();
    expect(ownProductPath('https://elsewhere.test/a.jpg', USER)).toBeNull();
  });

  it('skips a URL whose path does not decode instead of throwing', () => {
    expect(() => ownProductPath(`${base}${USER}/%E0%A4%A.jpg`, USER)).not.toThrow();
    expect(ownProductPath(`${base}${USER}/%E0%A4%A.jpg`, USER)).toBeNull();
  });
});

describe('removeAvatarFolder', () => {
  it('lists and removes page after page until the folder is empty', async () => {
    const folder = [['a', 'b'], ['c'], []];
    const removed: string[][] = [];
    await removeAvatarFolder(
      {
        list: async (_path, limit) => {
          expect(limit).toBe(STORAGE_PAGE_SIZE);
          return folder.shift() ?? [];
        },
        remove: async (paths) => {
          removed.push(paths);
        },
      },
      USER,
    );
    expect(removed).toEqual([[`${USER}/a`, `${USER}/b`], [`${USER}/c`]]);
  });

  it('stops after the page limit with a coded error so the retry continues', async () => {
    let listed = 0;
    const attempt = removeAvatarFolder(
      {
        list: async () => {
          listed += 1;
          return ['stuck'];
        },
        remove: async () => {},
      },
      USER,
    );
    await expect(attempt).rejects.toMatchObject({ code: 'storage_page_limit' });
    expect(listed).toBe(MAX_AVATAR_PAGES);
  });

  it('propagates a list or remove failure', async () => {
    await expect(
      removeAvatarFolder({ list: async () => { throw new Error('list'); }, remove: async () => {} }, USER),
    ).rejects.toThrow('list');
    await expect(
      removeAvatarFolder({ list: async () => ['a'], remove: async () => { throw new Error('remove'); } }, USER),
    ).rejects.toThrow('remove');
  });
});

describe('removeListingImages', () => {
  const url = (name: string) => `https://x.supabase.co/storage/v1/object/public/products/${USER}/${name}`;

  it('removes only own images of soft-deleted listings that never reached an order', async () => {
    const removed: string[][] = [];
    await removeListingImages(
      {
        listSoftDeletedProducts: async () => [
          { id: 'p1', images: [url('1.jpg'), 'https://elsewhere.test/x.jpg'] },
          { id: 'sold', images: [url('2.jpg')] },
          { id: 'p3', images: null },
          { id: 'bad', images: [url('%E0%A4%A.jpg'), url('3.jpg')] },
        ],
        findOrderedProductIds: async () => ['sold'],
        removeProductImages: async (paths) => {
          removed.push(paths);
        },
      },
      USER,
    );
    expect(removed).toEqual([[`${USER}/1.jpg`, `${USER}/3.jpg`]]);
  });

  it('does nothing without soft-deleted listings', async () => {
    let touched = false;
    await removeListingImages(
      {
        listSoftDeletedProducts: async () => [],
        findOrderedProductIds: async () => {
          touched = true;
          return [];
        },
        removeProductImages: async () => {
          touched = true;
        },
      },
      USER,
    );
    expect(touched).toBe(false);
  });
});

describe('createSupabaseClosurePorts.recordCleanup', () => {
  function fake() {
    const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
    const updates: { values: Record<string, unknown>; column: string; value: string }[] = [];
    const admin = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return { error: null };
      },
      from: (table: string) => {
        expect(table).toBe('account_closures');
        return {
          update: (values: Record<string, unknown>) => ({
            eq: async (column: string, value: string) => {
              updates.push({ values, column, value });
              return { error: null };
            },
          }),
        };
      },
    };
    const built = createSupabaseClosurePorts({
      getAdmin: () => admin as never,
      getStripe: () => ({ customers: { del: async () => ({}) }, accounts: { del: async () => ({}) } }),
    });
    return { built, rpcCalls, updates };
  }

  it('counts an attempt through the atomic RPC, never a read then write', async () => {
    const { built, rpcCalls, updates } = fake();
    await built.recordCleanup(USER, { attempt: true, last_error: 'storage:error' });
    expect(rpcCalls).toEqual([
      {
        name: 'fn_record_closure_attempt',
        args: { p_user_id: USER, p_last_error: 'storage:error', p_count_attempt: true },
      },
    ]);
    expect(updates).toEqual([]);
  });

  it('stamps last_error without counting', async () => {
    const { built, rpcCalls } = fake();
    await built.recordCleanup(USER, { finish: true, last_error: null });
    expect(rpcCalls[0].args).toEqual({ p_user_id: USER, p_last_error: null, p_count_attempt: false });
  });

  it('writes a step state with a plain update stamped updated_at', async () => {
    const { built, updates, rpcCalls } = fake();
    await built.recordCleanup(USER, { storage_cleanup: 'done' });
    expect(rpcCalls).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(updates[0].values.storage_cleanup).toBe('done');
    expect(typeof updates[0].values.updated_at).toBe('string');
    expect(updates[0]).toMatchObject({ column: 'user_id', value: USER });
  });

  it('throws when the database refuses the write', async () => {
    const admin = {
      rpc: async () => ({ error: { message: 'boom' } }),
      from: () => ({ update: () => ({ eq: async () => ({ error: { message: 'boom' } }) }) }),
    };
    const built = createSupabaseClosurePorts({
      getAdmin: () => admin as never,
      getStripe: () => ({ customers: { del: async () => ({}) }, accounts: { del: async () => ({}) } }),
    });
    await expect(built.recordCleanup(USER, { storage_cleanup: 'done' })).rejects.toThrow('boom');
    await expect(built.recordCleanup(USER, { attempt: true, last_error: null })).rejects.toThrow('boom');
  });
});
