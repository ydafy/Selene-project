import type { Notification } from '@selene/types';
import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

type Icon = ComponentProps<typeof MaterialCommunityIcons>['name'];
type Presentation = { icon: Icon; accent: 'primary' | 'success' | 'error'; state: 'generic' | 'purchase' | 'sale' | 'cancellation' | 'dispute' | 'listing' | 'return' };

const catalogue = {
  'order.payment_confirmed': { buyer: ['cart-check', 'success', 'purchase'], seller: ['storefront-outline', 'primary', 'sale'] },
  'shipment.cancelled': { buyer: ['package-variant-closed-remove', 'primary', 'cancellation'], seller: ['package-variant-closed-remove', 'primary', 'cancellation'] },
  'dispute.opened': { buyer: ['file-document-outline', 'primary', 'dispute'], seller: ['file-document-outline', 'primary', 'dispute'] },
  'dispute.verdict': { buyer: ['file-check-outline', 'primary', 'dispute'], seller: ['file-check-outline', 'primary', 'dispute'] },
  'product.approved': { seller: ['check-circle-outline', 'success', 'listing'] },
  'product.approved_with_note': { seller: ['check-circle-outline', 'success', 'listing'] },
  'product.rejected': { seller: ['pencil-outline', 'primary', 'listing'] },
  'return.seller_evidence_submitted': { buyer: ['file-document-outline', 'primary', 'return'] },
  'return.delivered': { buyer: ['package-variant-closed-check', 'primary', 'return'], seller: ['package-variant-closed-check', 'primary', 'return'] },
} as const;

/** Runtime metadata is optional until the deployed notification schema is regenerated. */
export function getNotificationPresentation(notification: Notification): Presentation {
  const row: Record<string, unknown> = notification;
  const kind = row.event_kind;
  const key = row.source_event_key;
  const payload = row.event_payload;
  if (typeof kind === 'string' && Object.prototype.hasOwnProperty.call(catalogue, kind) &&
    typeof key === 'string' && key.startsWith(`${kind}:`) && key.slice(kind.length + 1).trim().length > 0 &&
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const role = (payload as Record<string, unknown>).recipient_role;
    if (role === 'buyer' || role === 'seller') {
      const entry = catalogue[kind as keyof typeof catalogue] as Partial<Record<'buyer' | 'seller', readonly [Icon, Presentation['accent'], Presentation['state']]>>;
      const match = entry[role];
      if (match) return { icon: match[0], accent: match[1], state: match[2] };
    }
  }
  if (notification.type === 'error') return { icon: 'alert-circle-outline', accent: 'error', state: 'generic' };
  if (notification.type === 'success') return { icon: 'check-circle-outline', accent: 'success', state: 'generic' };
  if (notification.type === 'warning') return { icon: 'alert-outline', accent: 'primary', state: 'generic' };
  return { icon: 'bell-outline', accent: 'primary', state: 'generic' };
}
