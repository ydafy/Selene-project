import { describe, expect, test } from 'bun:test';
import type { AccountStatus } from '@selene/types';
import {
  ACCOUNT_STATUS_ACTION_TARGET,
  getAccountStatusActions,
} from './accountStatusActions';

describe('getAccountStatusActions', () => {
  const cases: [AccountStatus | null, boolean, string[]][] = [
    ['active', false, ['suspend', 'ban']],
    ['suspended', false, ['reactivate', 'ban']],
    ['banned', false, []],
    [null, false, ['suspend', 'ban']],
    ['active', true, []],
    ['suspended', true, []],
    ['banned', true, []],
    [null, true, []],
  ];

  test.each(cases)('status %p with isSelf %p allows %p', (status, isSelf, expected) => {
    expect(getAccountStatusActions(status, isSelf)).toEqual(expected);
  });

  test('maps each action to the RPC target status', () => {
    expect(ACCOUNT_STATUS_ACTION_TARGET).toEqual({
      suspend: 'suspended',
      reactivate: 'active',
      ban: 'banned',
    });
  });
});

test('UserSafetyActions renders only helper-allowed status actions', async () => {
  const component = await Bun.file(new URL('./UserSafetyActions.tsx', import.meta.url)).text();
  expect(component).toContain('getAccountStatusActions(user.status, user.id === admin?.id)');
  expect(component).toContain("actions.includes('suspend')");
  expect(component).toContain("actions.includes('reactivate')");
  expect(component).toContain("actions.includes('ban')");
  expect(component).not.toContain('volverán a ser VERIFIED');
  expect(component).toContain('estado que tenían antes de la suspensión');
});
