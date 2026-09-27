import { describe, expect, test } from 'bun:test';
import type { Notification } from '@selene/types';
import { getNotificationPresentation } from '../notificationPresentation';

const legacy: Notification = { id: 'n', user_id: 'u', created_at: '2026-01-01', deleted_at: null, title: 'Server title', message: 'Server message', type: 'error', read: false, action_path: '/profile/orders/123' };
// The deployed generated row is legacy-only; Object.assign models future runtime metadata without regenerating it.

describe('notification presentation', () => {
  test('uses verified catalogue identity and recipient role without replacing server copy', () => {
    expect(getNotificationPresentation(Object.assign({}, legacy, { event_kind: 'order.payment_confirmed', source_event_key: 'order.payment_confirmed:123:1', event_payload: { recipient_role: 'seller' } }))).toEqual({ icon: 'storefront-outline', accent: 'primary', state: 'sale' });
  });
  test('rejects unknown or malformed metadata instead of inferring from legacy severity', () => {
    for (const metadata of [
      { event_kind: 'unknown', source_event_key: 'unknown:123', event_payload: { recipient_role: 'seller' } },
      { event_kind: 'order.payment_confirmed', source_event_key: 'wrong:123', event_payload: { recipient_role: 'seller' } },
      { event_kind: 'order.payment_confirmed', source_event_key: 'order.payment_confirmed:123', event_payload: { recipient_role: 'admin' } },
      { event_kind: 'order.payment_confirmed', source_event_key: 'order.payment_confirmed:', event_payload: [] },
    ]) {
      expect(getNotificationPresentation(Object.assign({}, legacy, metadata))).toEqual({ icon: 'alert-circle-outline', accent: 'error', state: 'generic' });
    }
  });
  test('does not treat public notes or verdict as verified payment outcomes', () => {
    expect(getNotificationPresentation(Object.assign({}, legacy, { event_kind: 'dispute.verdict', source_event_key: 'dispute.verdict:123:1', event_payload: { recipient_role: 'buyer', internal_note: 'refund' } })).state).toBe('dispute');
  });
});
