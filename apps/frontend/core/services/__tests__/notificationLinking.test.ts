import { beforeEach, describe, expect, mock, test } from 'bun:test';

const push = mock<(path: string) => Promise<void>>(() => Promise.resolve());
mock.module('expo-router', () => ({ router: { push } }));

const { NotificationLinking } = await import('../notification');

const ID = '00000000-0000-4000-8000-0000000000b1';

const resolved = async (path: string | null): Promise<string> => {
  push.mockClear();
  await NotificationLinking.navigate(path);
  expect(push).toHaveBeenCalledTimes(1);
  return push.mock.calls[0][0];
};

describe('NotificationLinking.navigate', () => {
  beforeEach(() => push.mockClear());

  test.each([
    '/sell/onboarding',
    `/verify/${ID}`,
    '/profile/listings',
    `/product/${ID}`,
  ])('navigates to %s as is', async (path) => {
    expect(await resolved(path)).toBe(path);
  });

  test('redirects /profile to /profile/listings', async () => {
    expect(await resolved('/profile')).toBe('/profile/listings');
  });

  test('falls back to the inbox for unknown or missing paths', async () => {
    expect(await resolved('/sell/unknown')).toBe('/profile/notifications');
    expect(await resolved(null)).toBe('/profile/notifications');
  });
});
