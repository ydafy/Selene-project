import {
  normalizeEnviaTrackingStatus,
  type ShipmentStatusTransition,
  type ShipmentTrackingEventType,
} from './envia-tracking.ts';

export interface TrackingEventInput {
  trackingNumber: string;
  rawStatus: string;
  eventType: ShipmentTrackingEventType;
  transition: ShipmentStatusTransition;
  eventAt: string;
  statusDescription: string | null;
  location: string | null;
  carrierName: string | null;
}

type WebhookPayload = {
  type?: unknown;
  created_at?: unknown;
  data?: {
    tracking_number?: unknown;
    status?: unknown;
    status_description?: unknown;
    location?: unknown;
    carrier_name?: unknown;
  };
};

const optionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const validTimestamp = (value: unknown): string | null => {
  const timestamp = optionalString(value);
  return timestamp && !Number.isNaN(Date.parse(timestamp)) ? timestamp : null;
};

export const webhookReceipt = (deduplicated: boolean) => ({
  received: true,
  deduplicated,
});

export function buildWebhookTrackingEvent(
  payload: unknown,
): TrackingEventInput | null {
  if (!payload || typeof payload !== 'object') return null;
  const webhookPayload = payload as WebhookPayload;
  if (webhookPayload.type !== 'tracking.simple' || !webhookPayload.data)
    return null;

  const trackingNumber = optionalString(webhookPayload.data.tracking_number);
  const rawStatus = optionalString(webhookPayload.data.status);
  const eventAt = validTimestamp(webhookPayload.created_at);
  if (!trackingNumber || !rawStatus || !eventAt) return null;

  const normalized = normalizeEnviaTrackingStatus(rawStatus);
  return {
    trackingNumber,
    rawStatus,
    eventType: normalized.eventType,
    transition: normalized.shipmentTransition,
    eventAt,
    statusDescription: optionalString(webhookPayload.data.status_description),
    location: optionalString(webhookPayload.data.location),
    carrierName: optionalString(webhookPayload.data.carrier_name),
  };
}
