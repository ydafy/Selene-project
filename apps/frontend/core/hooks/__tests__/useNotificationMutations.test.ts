import { expect, test, describe, beforeEach } from 'bun:test';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';

import {
  invalidateNotificationKeys,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  dismissNotification,
  dismissAllNotifications,
  createDismissNotificationMutationOptions,
  createDismissAllMutationOptions,
} from '../useNotificationMutations.logic';

// ─── Fakes ────────────────────────────────────────────────────────────────

interface FakeCall {
  method: string;
  args: unknown[];
}

function createChainableClient(result: { error: Error | null } = { error: null }) {
  const calls: FakeCall[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: (table: unknown) => {
      calls.push({ method: 'from', args: [table] });
      return chain;
    },
    update: (data: unknown) => {
      calls.push({ method: 'update', args: [data] });
      return chain;
    },
    eq: (...args: unknown[]) => {
      calls.push({ method: 'eq', args });
      return chain;
    },
    is: (...args: unknown[]) => {
      calls.push({ method: 'is', args });
      return chain;
    },
    select: (...args: unknown[]) => {
      calls.push({ method: 'select', args });
      return chain;
    },
    order: (...args: unknown[]) => {
      calls.push({ method: 'order', args });
      return chain;
    },
    limit: (...args: unknown[]) => {
      calls.push({ method: 'limit', args });
      return chain;
    },
    then: (resolve: (value: { error: Error | null }) => unknown) => {
      return Promise.resolve(resolve(result));
    },
  };

  return {
    client: chain as unknown as Parameters<typeof dismissNotification>[0],
    calls,
    setResult(next: { error: Error | null }) {
      result.error = next.error;
    },
  };
}

function createFakeQueryClient(): QueryClient {
  const data = new Map<string, unknown>();
  const invalidated: unknown[][] = [];

  return {
    invalidateQueries: ({ queryKey }: { queryKey: unknown[] }) => {
      invalidated.push(queryKey);
    },
    cancelQueries: () => Promise.resolve(),
    setQueryData: (queryKey: unknown[], value: unknown) => {
      data.set(JSON.stringify(queryKey), value);
    },
    getQueryData: (queryKey: unknown[]) => data.get(JSON.stringify(queryKey)),
    // Exposed for assertions only
    __invalidated: invalidated,
    __data: data,
  } as unknown as QueryClient;
}

const t: TFunction = ((key: string) => key) as TFunction;

function createShowErrorSpy() {
  let called = false;
  return {
    fn: () => {
      called = true;
    },
    get called() {
      return called;
    },
  };
}

// ─── invalidateNotificationKeys ───────────────────────────────────────────

describe('invalidateNotificationKeys', () => {
  test('no-ops when userId is missing', () => {
    const qc = createFakeQueryClient();
    invalidateNotificationKeys(qc, undefined);
    expect((qc as unknown as { __invalidated: unknown[][] }).__invalidated).toHaveLength(0);
  });

  test('invalidates notifications and unread-notifications keys', () => {
    const qc = createFakeQueryClient();
    invalidateNotificationKeys(qc, 'user-1');
    const invalidated = (qc as unknown as { __invalidated: unknown[][] }).__invalidated;
    expect(invalidated).toEqual([
      ['notifications', 'user-1'],
      ['unread-notifications', 'user-1'],
    ]);
  });
});

// ─── dismissNotification mutationFn ───────────────────────────────────────

describe('dismissNotification', () => {
  test('updates deleted_at with id and user_id filters', async () => {
    const { client, calls } = createChainableClient();
    await dismissNotification(client, 'user-1', 'notif-1');

    expect(calls.find((c) => c.method === 'from')?.args).toEqual(['notifications']);
    const updateCall = calls.find((c) => c.method === 'update');
    expect(updateCall).toBeDefined();
    expect((updateCall!.args[0] as Record<string, unknown>).deleted_at).toBeTypeOf('string');

    const idEq = calls.find((c) => c.method === 'eq' && c.args[0] === 'id');
    const userEq = calls.find((c) => c.method === 'eq' && c.args[0] === 'user_id');
    expect(idEq?.args).toEqual(['id', 'notif-1']);
    expect(userEq?.args).toEqual(['user_id', 'user-1']);
  });

  test('throws when supabase returns an error', async () => {
    const { client } = createChainableClient({ error: new Error('db fail') });
    await expect(dismissNotification(client, 'user-1', 'notif-1')).rejects.toThrow('db fail');
  });
});

// ─── markNotificationAsRead mutationFn ────────────────────────────────────

describe('markNotificationAsRead', () => {
  test('updates read with id and user_id filters', async () => {
    const { client, calls } = createChainableClient();
    await markNotificationAsRead(client, 'user-1', 'notif-1');

    expect(calls.find((c) => c.method === 'from')?.args).toEqual(['notifications']);
    const updateCall = calls.find((c) => c.method === 'update');
    expect(updateCall).toBeDefined();
    expect((updateCall!.args[0] as Record<string, unknown>).read).toBe(true);

    const idEq = calls.find((c) => c.method === 'eq' && c.args[0] === 'id');
    const userEq = calls.find((c) => c.method === 'eq' && c.args[0] === 'user_id');
    expect(idEq?.args).toEqual(['id', 'notif-1']);
    expect(userEq?.args).toEqual(['user_id', 'user-1']);
  });

  test('throws when supabase returns an error', async () => {
    const { client } = createChainableClient({ error: new Error('db fail') });
    await expect(markNotificationAsRead(client, 'user-1', 'notif-1')).rejects.toThrow('db fail');
  });
});

// ─── markAllNotificationsAsRead mutationFn ────────────────────────────────

describe('markAllNotificationsAsRead', () => {
  test('updates read with user_id filter and excludes read/deleted rows', async () => {
    const { client, calls } = createChainableClient();
    await markAllNotificationsAsRead(client, 'user-1');

    expect(calls.find((c) => c.method === 'from')?.args).toEqual(['notifications']);
    const updateCall = calls.find((c) => c.method === 'update');
    expect(updateCall).toBeDefined();
    expect((updateCall!.args[0] as Record<string, unknown>).read).toBe(true);

    const userEq = calls.find((c) => c.method === 'eq' && c.args[0] === 'user_id');
    expect(userEq?.args).toEqual(['user_id', 'user-1']);

    const readEq = calls.find((c) => c.method === 'eq' && c.args[0] === 'read');
    expect(readEq?.args).toEqual(['read', false]);

    const isCall = calls.find((c) => c.method === 'is');
    expect(isCall?.args).toEqual(['deleted_at', null]);
  });

  test('throws when supabase returns an error', async () => {
    const { client } = createChainableClient({ error: new Error('db fail') });
    await expect(markAllNotificationsAsRead(client, 'user-1')).rejects.toThrow('db fail');
  });
});

// ─── dismissAll mutationFn ────────────────────────────────────────────────

describe('dismissAllNotifications', () => {
  test('updates deleted_at with only user_id filter', async () => {
    const { client, calls } = createChainableClient();
    await dismissAllNotifications(client, 'user-1');

    expect(calls.find((c) => c.method === 'from')?.args).toEqual(['notifications']);
    expect(calls.find((c) => c.method === 'update')).toBeDefined();

    const idEq = calls.find((c) => c.method === 'eq' && c.args[0] === 'id');
    expect(idEq).toBeUndefined();

    const userEq = calls.find((c) => c.method === 'eq' && c.args[0] === 'user_id');
    expect(userEq?.args).toEqual(['user_id', 'user-1']);
  });

  test('throws when supabase returns an error', async () => {
    const { client } = createChainableClient({ error: new Error('db fail') });
    await expect(dismissAllNotifications(client, 'user-1')).rejects.toThrow('db fail');
  });
});

// ─── optimistic badge update on dismissNotification ───────────────────────

describe('dismissNotification optimistic badge update', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = createFakeQueryClient();
  });

  test('onMutate decrements unread count and snapshots previous value', async () => {
    qc.setQueryData(['unread-notifications', 'user-1'], 5);
    const showError = createShowErrorSpy();
    const options = createDismissNotificationMutationOptions(qc, 'user-1', t, showError.fn);
    const context = await options.onMutate!('notif-1');

    expect(qc.getQueryData(['unread-notifications', 'user-1']) as number).toBe(4);
    expect(context).toEqual({ previousUnread: 5 });
  });

  test('onMutate clamps count at zero', async () => {
    qc.setQueryData(['unread-notifications', 'user-1'], 0);
    const showError = createShowErrorSpy();
    const options = createDismissNotificationMutationOptions(qc, 'user-1', t, showError.fn);
    const context = await options.onMutate!('notif-1');

    expect(qc.getQueryData(['unread-notifications', 'user-1']) as number).toBe(0);
    expect(context).toEqual({ previousUnread: 0 });
  });

  test('onError restores previous unread count and shows error toast', () => {
    qc.setQueryData(['unread-notifications', 'user-1'], 4);
    const showError = createShowErrorSpy();
    const options = createDismissNotificationMutationOptions(qc, 'user-1', t, showError.fn);
    options.onError!(new Error('fail'), 'notif-1', { previousUnread: 5 });

    expect(qc.getQueryData(['unread-notifications', 'user-1']) as number).toBe(5);
    expect(showError.called).toBe(true);
  });

  test('onError ignores missing context', () => {
    qc.setQueryData(['unread-notifications', 'user-1'], 4);
    const showError = createShowErrorSpy();
    const options = createDismissNotificationMutationOptions(qc, 'user-1', t, showError.fn);
    options.onError!(new Error('fail'), 'notif-1', undefined);

    expect(qc.getQueryData(['unread-notifications', 'user-1']) as number).toBe(4);
  });
});

// ─── optimistic badge update on dismissAll ────────────────────────────────

describe('dismissAll optimistic badge update', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = createFakeQueryClient();
  });

  test('onMutate zeros unread count and snapshots previous value', async () => {
    qc.setQueryData(['unread-notifications', 'user-1'], 12);
    const showError = createShowErrorSpy();
    const options = createDismissAllMutationOptions(qc, 'user-1', t, showError.fn);
    const context = await options.onMutate!();

    expect(qc.getQueryData(['unread-notifications', 'user-1']) as number).toBe(0);
    expect(context).toEqual({ previousUnread: 12 });
  });

  test('onError restores previous unread count and shows error toast', () => {
    qc.setQueryData(['unread-notifications', 'user-1'], 0);
    const showError = createShowErrorSpy();
    const options = createDismissAllMutationOptions(qc, 'user-1', t, showError.fn);
    options.onError!(new Error('fail'), undefined, { previousUnread: 7 });

    expect(qc.getQueryData(['unread-notifications', 'user-1']) as number).toBe(7);
    expect(showError.called).toBe(true);
  });
});
