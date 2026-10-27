import { describe, expect, test } from 'bun:test';
import { readAutoCancelExpirationHours } from './auto-cancel-settings';

const clientReturning = (result: { data: unknown; error?: unknown }) => {
  const selected: string[] = [];
  const client = {
    from: (table: string) => {
      selected.push(table);
      return {
        select: (column: string) => {
          selected.push(column);
          return { single: async () => ({ error: null, ...result }) };
        },
      };
    },
  };
  return { client, selected };
};

describe('readAutoCancelExpirationHours', () => {
  test('returns the positive integer stored in the requested column', async () => {
    const { client, selected } = clientReturning({
      data: { order_expiration_hours: 24 },
    });
    const logs: unknown[][] = [];
    const result = await readAutoCancelExpirationHours(
      client,
      'order_expiration_hours',
      (...args) => logs.push(args),
    );
    expect(result).toEqual({ hours: 24 });
    expect(selected).toEqual(['system_settings', 'order_expiration_hours']);
    expect(logs).toEqual([]);
  });

  for (const [label, result, logged] of [
    ['null', { data: { preparing_expiration_hours: null } }, null],
    ['0', { data: { preparing_expiration_hours: 0 } }, 0],
    ['-1', { data: { preparing_expiration_hours: -1 } }, -1],
    ['1.5', { data: { preparing_expiration_hours: 1.5 } }, 1.5],
    ['a string', { data: { preparing_expiration_hours: '24' } }, '24'],
    ['a missing row', { data: null }, null],
    ['a read error', { data: { preparing_expiration_hours: 24 }, error: { message: 'boom' } }, 24],
  ] as const)
    test(`${label} yields the 500 AUTO_CANCEL_SETTINGS_INVALID response and one ERROR log`, async () => {
      const { client } = clientReturning(result);
      const logs: unknown[][] = [];
      const outcome = await readAutoCancelExpirationHours(
        client,
        'preparing_expiration_hours',
        (...args) => logs.push(args),
      );
      if (!('response' in outcome)) throw new Error('expected a response');
      expect(outcome.response.status).toBe(500);
      expect(outcome.response.headers.get('Content-Type')).toBe('application/json');
      expect(await outcome.response.text()).toBe('{"error":"AUTO_CANCEL_SETTINGS_INVALID"}');
      expect(logs).toEqual([
        ['ERROR', 'Auto-cancel settings invalid', { setting: 'preparing_expiration_hours', value: logged }],
      ]);
    });
});
