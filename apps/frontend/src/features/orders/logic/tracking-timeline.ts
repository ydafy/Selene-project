import type { ShipmentTrackingEvent } from '@selene/types';

type TimelineEvent = Pick<
  ShipmentTrackingEvent,
  'raw_status' | 'status_description'
>;

export function getTrackingEventDescription(event: TimelineEvent): string {
  return event.status_description || event.raw_status;
}

export function getTrackingEventLabelKey(
  eventType: ShipmentTrackingEvent['event_type'],
): `orders:tracking.events.${ShipmentTrackingEvent['event_type']}` {
  return `orders:tracking.events.${eventType}`;
}
