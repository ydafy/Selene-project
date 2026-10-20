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

export interface PollingTrackingTarget {
  id: string;
  trackingNumber: string;
}

export interface EnviaPollingObservation {
  trackingNumber: string;
  status: string;
  eventAt?: string | null;
  statusDescription?: string | null;
  location?: string | null;
  carrierName?: string | null;
}

export interface PollingTrackingEvent extends TrackingEventInput {
  targetId: string;
}

type UnknownRecord = Record<string, unknown>;

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

const buildTrackingEvent = (input: {
  trackingNumber: unknown;
  status: unknown;
  eventAt: unknown;
  statusDescription?: unknown;
  location?: unknown;
  carrierName?: unknown;
}): TrackingEventInput | null => {
  const trackingNumber = optionalString(input.trackingNumber);
  const rawStatus = optionalString(input.status);
  const eventAt = validTimestamp(input.eventAt);
  if (!trackingNumber || !rawStatus || !eventAt) return null;

  const normalized = normalizeEnviaTrackingStatus(rawStatus);
  return {
    trackingNumber,
    rawStatus,
    eventType: normalized.eventType,
    transition: normalized.shipmentTransition,
    eventAt,
    statusDescription: optionalString(input.statusDescription),
    location: optionalString(input.location),
    carrierName: optionalString(input.carrierName),
  };
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
  return buildTrackingEvent({
    trackingNumber: webhookPayload.data.tracking_number,
    status: webhookPayload.data.status,
    eventAt: webhookPayload.created_at,
    statusDescription: webhookPayload.data.status_description,
    location: webhookPayload.data.location,
    carrierName: webhookPayload.data.carrier_name,
  });
}

export function buildPollingTrackingEvents(
  targets: readonly PollingTrackingTarget[],
  observations: readonly EnviaPollingObservation[],
  polledAt: string,
): PollingTrackingEvent[] {
  return observations.flatMap((observation) => {
    const event = buildTrackingEvent({
      trackingNumber: observation.trackingNumber,
      status: observation.status,
      eventAt: observation.eventAt ?? polledAt,
      statusDescription: observation.statusDescription,
      location: observation.location,
      carrierName: observation.carrierName,
    });
    if (!event) return [];
    return targets
      .filter((target) => target.trackingNumber === event.trackingNumber)
      .map((target) => ({ targetId: target.id, ...event }));
  });
}

const pollingObservation = (
  value: UnknownRecord,
  fallbackTrackingNumber?: unknown,
  fallbackCarrierName?: unknown,
): EnviaPollingObservation | null => {
  const trackingNumber = optionalString(
    value.trackingNumber ?? value.tracking_number ?? fallbackTrackingNumber,
  );
  const status = optionalString(value.status);
  if (!trackingNumber || !status) return null;
  return {
    trackingNumber,
    status,
    eventAt: optionalString(
      value.eventAt ??
        value.event_at ??
        value.date ??
        value.created_at ??
        value.updated_at,
    ),
    statusDescription: optionalString(
      value.statusDescription ?? value.status_description,
    ),
    location: optionalString(value.location),
    carrierName: optionalString(
      value.carrierName ?? value.carrier_name ?? fallbackCarrierName,
    ),
  };
};

export function extractEnviaPollingObservations(
  value: unknown,
): EnviaPollingObservation[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as UnknownRecord;
  const history = record.history ?? record.events;
  if (Array.isArray(history) && history.length > 0) {
    return history.flatMap((entry) =>
      entry && typeof entry === 'object'
        ? ([
            pollingObservation(
              entry as UnknownRecord,
              record.trackingNumber ?? record.tracking_number,
              record.carrierName ?? record.carrier_name,
            ),
          ].filter(Boolean) as EnviaPollingObservation[])
        : [],
    );
  }
  const observation = pollingObservation(record);
  return observation ? [observation] : [];
}

export function successfulPollingTargetIds(
  targets: readonly PollingTrackingTarget[],
  validEvents?: readonly Pick<PollingTrackingEvent, 'targetId'>[],
  fullyPersistedTargetIds?: ReadonlySet<string>,
): string[] {
  if (!validEvents || !fullyPersistedTargetIds) {
    return [...new Set(targets.map((target) => target.id))];
  }

  const validObservationTargetIds = new Set(
    validEvents.map((event) => event.targetId),
  );
  return [...new Set(targets.map((target) => target.id))].filter(
    (targetId) =>
      validObservationTargetIds.has(targetId) &&
      fullyPersistedTargetIds.has(targetId),
  );
}
