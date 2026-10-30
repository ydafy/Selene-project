import { describe, expect, test } from 'bun:test';
import { isClosedAccount } from './accountStatus';

describe('isClosedAccount', () => {
  test('a banned account with a deleted_ + 12 hex username is closed', () => {
    expect(isClosedAccount({ status: 'banned', username: 'deleted_0123456789ab' })).toBe(true);
  });

  test.each([
    [{ status: 'banned', username: 'ordinary_user' }],
    [{ status: 'active', username: 'deleted_0123456789ab' }],
    [{ status: 'suspended', username: 'deleted_0123456789ab' }],
    [{ status: 'banned', username: 'deleted_0123456789a' }],
    [{ status: 'banned', username: 'deleted_0123456789abc' }],
    [{ status: 'banned', username: 'deleted_0123456789AB' }],
    [{ status: 'banned', username: null }],
    [{ status: null, username: null }],
  ] as const)('%p is not closed', (user) => {
    expect(isClosedAccount(user)).toBe(false);
  });
});
