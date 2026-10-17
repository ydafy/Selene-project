import type { Tables } from '@selene/types';

type ShipmentLabelSnapshot = Pick<
  Tables<'shipments'>,
  'status' | 'label_url' | 'tracking_number' | 'label_generation_state'
>;

export type ShipmentLabelState =
  'available' | 'ready' | 'processing' | 'reconciliation' | 'unavailable';

export type LabelRecoveryState = Exclude<
  ShipmentLabelState,
  'available' | 'ready'
>;

/** Only a proven pre-purchase state may offer label creation. */
export function resolveShipmentLabelState(
  shipment: ShipmentLabelSnapshot | null,
  readFailed = false,
): ShipmentLabelState {
  if (!shipment) return 'unavailable';
  if (shipment.label_url) return 'available';
  if (readFailed) return 'unavailable';
  if (shipment.tracking_number) return 'reconciliation';

  switch (shipment.label_generation_state) {
    case 'claimed':
    case 'generation_sent':
      return 'processing';
    case 'orphan_pending':
    case 'generated':
      return 'reconciliation';
    case 'unclaimed':
    case 'retryable_rejected':
      return shipment.status === 'paid' ? 'ready' : 'unavailable';
    default:
      return 'unavailable';
  }
}

export function isLabelRecoveryState(
  state: ShipmentLabelState,
): state is LabelRecoveryState {
  return state !== 'available' && state !== 'ready';
}
