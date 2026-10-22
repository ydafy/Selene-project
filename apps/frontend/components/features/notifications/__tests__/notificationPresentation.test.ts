import { describe, expect, test } from 'bun:test';
import type { Notification } from '@selene/types';
import en from '../../../../core/i18n/locales/en/notifications.json';
import es from '../../../../core/i18n/locales/es/notifications.json';
import { getNotificationPresentation } from '../notificationPresentation';

const legacy: Notification = { id: 'n', user_id: 'u', created_at: '2026-01-01', deleted_at: null, title: 'Server title', message: 'Server message', type: 'error', read: false, action_path: '/profile/orders/123', event_kind: null, source_event_key: null, event_payload: {} };

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
  test('presents a verified buyer refund failure as an error refund update and rejects other roles', () => {
    const failed = { event_kind: 'shipment.refund_failed', source_event_key: 'shipment.refund_failed:ship-1:re_1', event_payload: { recipient_role: 'buyer' } };
    expect(getNotificationPresentation(Object.assign({}, legacy, failed, { type: 'info' }))).toEqual({ icon: 'cash-refund', accent: 'error', state: 'refund' });
    for (const role of ['seller', 'admin']) {
      expect(getNotificationPresentation(Object.assign({}, legacy, failed, { event_payload: { recipient_role: role } }))).toEqual({ icon: 'alert-circle-outline', accent: 'error', state: 'generic' });
    }
  });
  test('every presentation state has an English and Spanish label', () => {
    for (const { states } of [en, es] as Array<{ states: Record<string, unknown> }>) {
      for (const state of ['generic', 'purchase', 'sale', 'cancellation', 'refund', 'dispute', 'listing', 'return']) {
        expect(typeof states[state]).toBe('string');
      }
    }
  });
  test('does not treat public notes or verdict as verified payment outcomes', () => {
    expect(getNotificationPresentation(Object.assign({}, legacy, { event_kind: 'dispute.verdict', source_event_key: 'dispute.verdict:123:1', event_payload: { recipient_role: 'buyer', internal_note: 'refund' } })).state).toBe('dispute');
  });
});
