import { beforeEach, describe, expect, mock, test } from 'bun:test';

const push = mock<(path: string) => Promise<void>>(() => Promise.resolve());
mock.module('expo-router', () => ({ router: { push } }));

const { NotificationLinking } = await import('./notification-linking');

const ID = '00000000-0000-4000-8000-0000000000b1';
const SHIPMENT_ID = '00000000-0000-4000-8000-0000000000c2';

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

  test('opens one shipment of an order when the path names it', async () => {
    const path = `/profile/orders/${ID}?shipment_id=${SHIPMENT_ID}`;
    expect(await resolved(path)).toBe(path);
  });

  test('keeps opening an order without a shipment', async () => {
    expect(await resolved(`/profile/orders/${ID}`)).toBe(
      `/profile/orders/${ID}`,
    );
  });

  test.each([
    [
      'a shipment id that is not a uuid',
      `/profile/orders/${ID}?shipment_id=abc`,
    ],
    [
      'an order id that is not a uuid',
      `/profile/orders/abc?shipment_id=${SHIPMENT_ID}`,
    ],
    ['an empty shipment id', `/profile/orders/${ID}?shipment_id=`],
    ['another query parameter', `/profile/orders/${ID}?status=paid`],
    [
      'an extra query parameter',
      `/profile/orders/${ID}?shipment_id=${SHIPMENT_ID}&x=1`,
    ],
    [
      'a repeated shipment id',
      `/profile/orders/${ID}?shipment_id=${SHIPMENT_ID}&shipment_id=${SHIPMENT_ID}`,
    ],
    ['a fragment', `/profile/orders/${ID}?shipment_id=${SHIPMENT_ID}#top`],
    ['a query on another route', `/product/${ID}?shipment_id=${SHIPMENT_ID}`],
    ['an empty query', `/profile/orders/${ID}?`],
  ])('falls back to the inbox for %s', async (_case, path) => {
    expect(await resolved(path)).toBe('/profile/notifications');
  });

  test('falls back to the inbox for unknown or missing paths', async () => {
    expect(await resolved('/sell/unknown')).toBe('/profile/notifications');
    expect(await resolved(null)).toBe('/profile/notifications');
  });
});
