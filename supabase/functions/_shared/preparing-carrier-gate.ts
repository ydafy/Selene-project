import { buildPollingTrackingEvents } from './envia-tracking-ingestion.ts';
import type { PollingTrackingEvent } from './envia-tracking-ingestion.ts';
import type {
  EnviaCancelOutcome,
  FreshTrackingAssessment,
} from './envia-carrier-cancellation.ts';
import type { CancellationConfirmation } from './shipment-cancellation.ts';

export type ReviewReason =
  'tracking_unknown' | 'carrier_refused' | 'carrier_ambiguous';
type AcceptedCancellation = Extract<EnviaCancelOutcome, { outcome: 'accepted' }>;

export interface PreparingCarrierShipment {
  id: string;
  trackingNumber: string | null;
  carrier: string | null;
  /** Source of the winning claim; the carrier RPCs only accept `preparing_timeout`. */
  source: string;
}

export interface PreparingCarrierGatePorts {
  /** False when the Envia configuration is missing: no carrier call can be made this run. */
  carrierAvailable: boolean;
  /** Service RPC `fn_get_shipment_carrier_cancellation`. */
  getStoredState: (shipmentId: string) => Promise<unknown>;
  fetchFreshTracking: (trackingNumber: string) => Promise<FreshTrackingAssessment>;
  /**
   * Service RPC `fn_record_tracking_event`; throws on failure. Returns the shipment status
   * after the event, so the gate can tell whether the shipment actually left `preparing`.
   */
  recordTrackingEvent: (
    event: PollingTrackingEvent,
    pollingRunId: string,
  ) => Promise<string | null>;
  cancelLabel: (input: {
    carrier: string;
    trackingNumber: string;
  }) => Promise<EnviaCancelOutcome>;
  /** Service RPC `fn_record_shipment_carrier_cancellation` for an accepted answer. */
  recordOutcome: (
    shipmentId: string,
    claimToken: string,
    outcome: AcceptedCancellation,
  ) => Promise<void>;
  /** Service RPC `fn_mark_shipment_cancellation_review`: `{ marked }`, true only the first time. */
  markReview: (
    shipmentId: string,
    claimToken: string,
    reason: ReviewReason,
  ) => Promise<unknown>;
  /** Awaited; its own failure never changes the outcome. */
  reportCritical: (message: string, data: Record<string, unknown>) => unknown;
  now: () => string;
  newRunId: () => string;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const nonblank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const stop = (reason: string): CancellationConfirmation => ({
  proceed: false,
  reason,
});

async function markForReview(
  ports: PreparingCarrierGatePorts,
  shipmentId: string,
  claimToken: string,
  reason: ReviewReason,
): Promise<CancellationConfirmation> {
  const result = await ports.markReview(shipmentId, claimToken, reason);
  if (!record(result) || typeof result.marked !== 'boolean') {
    throw new Error('CARRIER_REVIEW_MARK_INVALID');
  }
  // Only the call that newly set the marker alerts, so a stuck shipment alerts once.
  if (result.marked) {
    await ports.reportCritical(
      'Preparing cancellation needs carrier review; no refund was made',
      { shipmentId, reason },
    );
  }
  return stop(reason);
}

async function recordObservations(
  ports: PreparingCarrierGatePorts,
  shipment: { id: string; trackingNumber: string },
  claimToken: string,
  assessment: FreshTrackingAssessment,
): Promise<CancellationConfirmation> {
  const events = buildPollingTrackingEvents(
    [{ id: shipment.id, trackingNumber: shipment.trackingNumber }],
    assessment.observations,
    ports.now(),
  );
  const pollingRunId = ports.newRunId();
  let status: string | null = null;
  for (const event of events) {
    status = await ports.recordTrackingEvent(event, pollingRunId);
  }
  // `fn_record_tracking_event` only moves `preparing` to `shipped`: a history it cannot act on
  // (delivered only) leaves the shipment preparing, so stopping here would loop every run.
  if (status === null || status === 'preparing') {
    return markForReview(ports, shipment.id, claimToken, 'tracking_unknown');
  }
  return stop('tracking_advanced');
}

/**
 * Carrier evidence required before a preparing-timeout refund (L15). Continues only on an
 * admin-approved refund or a carrier-accepted label cancellation; every other branch stops
 * the run with no refund. The accepted/approved check reads the stored state first, so a
 * run that died after the carrier accepted never calls Envia a second time.
 */
export async function confirmPreparingCarrier(
  shipment: PreparingCarrierShipment,
  claimToken: string,
  ports: PreparingCarrierGatePorts,
): Promise<CancellationConfirmation> {
  // The carrier RPCs reject any other source; stopping here avoids a cancelled label that
  // can never be recorded or reviewed. Checked before every port call.
  if (shipment.source !== 'preparing_timeout') return stop('source_mismatch');

  const stored = await ports.getStoredState(shipment.id);
  if (!record(stored)) throw new Error('CARRIER_STATE_INVALID');

  // A review that is not approved blocks the refund even if an outcome is stored (L17).
  if (stored.review_resolution === 'refund_approved') return { proceed: true };
  if (stored.review_required_at != null) return stop('under_review');
  if (stored.carrier_cancellation_outcome === 'accepted') {
    return { proceed: true };
  }

  const { trackingNumber, carrier } = shipment;
  if (!nonblank(trackingNumber) || !nonblank(carrier)) {
    return markForReview(ports, shipment.id, claimToken, 'tracking_unknown');
  }
  if (!ports.carrierAvailable) return stop('carrier_unavailable');
  const target = { id: shipment.id, trackingNumber };

  const fresh = await ports.fetchFreshTracking(trackingNumber);
  if (fresh.state === 'unavailable') return stop('carrier_unavailable');
  if (fresh.state === 'scanned') {
    return recordObservations(ports, target, claimToken, fresh);
  }
  if (fresh.state === 'unknown') {
    return markForReview(ports, shipment.id, claimToken, 'tracking_unknown');
  }

  const cancelled = await ports.cancelLabel({ carrier, trackingNumber });
  switch (cancelled.outcome) {
    case 'accepted':
      await ports.recordOutcome(shipment.id, claimToken, cancelled);
      return { proceed: true };
    case 'refused': {
      // A refusal usually means the carrier already scanned the package: re-read before alerting.
      const recheck = await ports.fetchFreshTracking(trackingNumber);
      if (recheck.state === 'scanned') {
        return recordObservations(ports, target, claimToken, recheck);
      }
      return markForReview(ports, shipment.id, claimToken, 'carrier_refused');
    }
    case 'ambiguous':
      return markForReview(ports, shipment.id, claimToken, 'carrier_ambiguous');
    default:
      return stop('carrier_unavailable');
  }
}
