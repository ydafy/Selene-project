import { expect, test } from 'bun:test';
import { fetchNotificationPage } from '../notificationPagination';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Notification } from '@selene/types';

function fakeInbox(rows: Notification[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  let owner = '', deleted = false, cursorFilter: string | null = null;
  let timestampLt: string | null = null;
  let size = 0;
  const chain = {
    from(table: string) {
      owner = ''; deleted = false; cursorFilter = null; timestampLt = null; size = 0;
      calls.push({ method: 'from', args: [table] }); return chain;
    },
    select(columns: string) { calls.push({ method: 'select', args: [columns] }); return chain; },
    eq(column: string, value: string) {
      calls.push({ method: 'eq', args: [column, value] });
      if (column === 'user_id') owner = value;
      return chain;
    },
    is(column: string, value: null) {
      calls.push({ method: 'is', args: [column, value] });
      if (column === 'deleted_at') deleted = true;
      return chain;
    },
    lt(column: string, value: string) {
      calls.push({ method: 'lt', args: [column, value] });
      if (column === 'created_at') timestampLt = value;
      return chain;
    },
    or(filter: string) { calls.push({ method: 'or', args: [filter] }); cursorFilter = filter; return chain; },
    order(column: string, options: unknown) { calls.push({ method: 'order', args: [column, options] }); return chain; },
    limit(value: number) { calls.push({ method: 'limit', args: [value] }); size = value; return chain; },
    then(resolve: (result: { data: Notification[]; error: null }) => unknown) {
      const match = cursorFilter?.match(/^created_at\.lt\.(.*),and\(created_at\.eq\.(.*),id\.lt\.(.*)\)$/);
      const filtered = rows.filter(row => row.user_id === owner && (!deleted || row.deleted_at === null))
        .filter(row => !timestampLt || row.created_at < timestampLt)
        .filter(row => !cursorFilter || (match !== null && match !== undefined &&
          (row.created_at < match[1] || (row.created_at === match[2] && row.id < match[3]))))
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      return Promise.resolve(resolve({ data: filtered.slice(0, size), error: null }));
    },
  };
  return { client: chain as unknown as SupabaseClient<Database>, calls };
}

const row = (id: string, created_at = '2024-01-15T00:00:00Z', user_id = 'owner', deleted_at: string | null = null): Notification => ({
  id, created_at, user_id, deleted_at, read: false, title: id, message: null, type: null, action_path: null,
});

test('query returns exactly 20 visible rows, then all tied and older rows without repeats', async () => {
  const visible = Array.from({ length: 43 }, (_, i) => row(String(100 - i).padStart(3, '0'), i < 24 ? '2024-01-15T00:00:00Z' : '2024-01-14T00:00:00Z'));
  const { client, calls } = fakeInbox([...visible, row('999', undefined, 'other'), row('998', undefined, 'owner', '2024-01-16')]);
  const first = await fetchNotificationPage(client, 'owner', null);
  expect(first.items.map(item => item.id)).toEqual(visible.slice(0, 20).map(item => item.id));
  expect(first.cursor).toEqual({ created_at: visible[19].created_at, id: visible[19].id });
  expect(calls.filter(call => call.method === 'limit').map(call => call.args)).toEqual([[21]]);
  const second = await fetchNotificationPage(client, 'owner', first.cursor);
  expect(second.items.map(item => item.id)).toEqual(visible.slice(20, 40).map(item => item.id));
  expect(calls.filter(call => call.method === 'or').at(-1)?.args).toEqual([
    `created_at.lt.${visible[19].created_at},and(created_at.eq.${visible[19].created_at},id.lt.${visible[19].id})`,
  ]);
  const third = await fetchNotificationPage(client, 'owner', second.cursor);
  expect(third.items.map(item => item.id)).toEqual(visible.slice(40).map(item => item.id));
  expect(third.cursor).toBeNull();
  expect([...first.items, ...second.items, ...third.items].map(item => item.id)).toEqual(visible.map(item => item.id));
});
