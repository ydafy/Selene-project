// Pure decision logic for Stripe refund.updated / refund.failed events that belong to a
// shipment cancellation. index.ts only wires the RPC and the reporter into these ports.

const SHIPMENT_REFUND_EVENT_TYPES = ['refund.updated', 'refund.failed'] as const;
const REFUND_STATUSES = ['pending', 'requires_action', 'succeeded', 'failed', 'canceled'] as const;
const OUTCOMES = [
  'ignored',
  'completed',
  'unchanged',
  'recorded',
  'failed_after_cancellation',
  'failed_before_cancellation',
  'after_resolution',
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Outcome = (typeof OUTCOMES)[number];

export type ShipmentRefundEventInput = {
  shipmentId: string;
  refundId: string;
  paymentIntentId: string;
  amountCents: number;
  status: string;
  failureReason: string | null;
};

export type ShipmentRefundEventPorts = {
  apply: (
    input: ShipmentRefundEventInput,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  report: (message: string, data: Record<string, unknown>) => Promise<void>;
  log: (level: 'WARN' | 'ERROR', msg: string, data?: Record<string, unknown>) => unknown;
};

export type ShipmentRefundEventResult =
  | { handled: false; reason: 'unsupported_event_type' | 'not_a_shipment_refund' | 'dispute_refund' }
  | { handled: true; outcome: Outcome };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const nonBlankString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const malformed = (): Error => new Error('REFUND_EVENT_MALFORMED');

export async function handleShipmentRefundEvent(
  event: { id?: unknown; type: string; data: { object: unknown } },
  ports: ShipmentRefundEventPorts,
): Promise<ShipmentRefundEventResult> {
  if (!(SHIPMENT_REFUND_EVENT_TYPES as readonly string[]).includes(event.type)) {
    return { handled: false, reason: 'unsupported_event_type' };
  }

  const refund = asRecord(event.data.object);
  const metadata = asRecord(refund?.metadata);
  const shipmentId = metadata?.shipment_id;
  // Not ours: refunds created elsewhere never carry a shipment id of ours.
  if (!refund || !metadata || !nonBlankString(shipmentId) || !UUID.test(shipmentId.trim())) {
    return { handled: false, reason: 'not_a_shipment_refund' };
  }
  // resolve-dispute-refund also sets shipment_id, so shipment metadata alone is not proof.
  const disputeId = metadata.dispute_id;
  if (disputeId !== undefined && disputeId !== null && disputeId !== '') {
    return { handled: false, reason: 'dispute_refund' };
  }

  const paymentIntent = refund.payment_intent;
  const paymentIntentId = nonBlankString(paymentIntent)
    ? paymentIntent
    : asRecord(paymentIntent)?.id;
  if (
    !nonBlankString(refund.id) ||
    !nonBlankString(paymentIntentId) ||
    typeof refund.amount !== 'number' ||
    !Number.isSafeInteger(refund.amount) ||
    refund.amount <= 0 ||
    typeof refund.status !== 'string' ||
    !(REFUND_STATUSES as readonly string[]).includes(refund.status)
  ) {
    throw malformed();
  }

  const { data, error } = await ports.apply({
    shipmentId: shipmentId.trim(),
    refundId: refund.id,
    paymentIntentId,
    amountCents: refund.amount,
    status: refund.status,
    failureReason: typeof refund.failure_reason === 'string' ? refund.failure_reason : null,
  });
  if (error) {
    // The raw RPC message stays in the log; the thrown code is all the webhook response shows.
    ports.log('ERROR', 'Shipment refund event RPC failed', {
      shipmentId: shipmentId.trim(),
      refundId: refund.id,
      error: error.message,
    });
    throw new Error('REFUND_EVENT_RPC_FAILED');
  }

  const result = asRecord(data);
  const outcome = result?.outcome;
  if (!result || typeof outcome !== 'string' || !(OUTCOMES as readonly string[]).includes(outcome)) {
    throw new Error('REFUND_EVENT_RESULT_INVALID');
  }

  if (outcome === 'failed_after_cancellation' || outcome === 'failed_before_cancellation') {
    // The RPC already committed; the alert must not be lost to an unusable detail.
    await ports.report(`SHIPMENT_REFUND_${outcome.toUpperCase()}`, {
      shipmentId: shipmentId.trim(),
      refundId: refund.id,
      amountOwedCents:
        typeof result.amount_owed_cents === 'number' ? result.amount_owed_cents : null,
      failureReason:
        typeof result.refund_failure_reason === 'string' ? result.refund_failure_reason : null,
      outcome,
    });
  }

  if (outcome === 'after_resolution') {
    // The operation is already resolved, so nothing was written: this is the only signal that
    // Stripe moved money (or failed to) after the admin settled it by hand.
    await ports.report('SHIPMENT_REFUND_EVENT_AFTER_RESOLUTION', {
      shipmentId: shipmentId.trim(),
      refundId: refund.id,
      status: refund.status,
      amountOwedCents:
        typeof result.amount_owed_cents === 'number' ? result.amount_owed_cents : null,
      resolutionReference:
        typeof result.resolution_reference === 'string' ? result.resolution_reference : null,
      outcome,
    });
  }

  return { handled: true, outcome: outcome as Outcome };
}
