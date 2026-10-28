import {
  parseAcknowledgement,
  parseLateCarrierActivity,
  type AcknowledgementResult,
  type LateCarrierActivity,
} from '../lib/lateCarrierActivity';
import { invokeEdgeJson } from './edge-client';

export async function fetchLateCarrierActivity(): Promise<LateCarrierActivity[]> {
  return parseLateCarrierActivity(await invokeEdgeJson('list-shipment-late-carrier-activity', { method: 'GET' }));
}

/** Only the shipment id and the note are sent; the server validates the admin, the note and the case. */
export async function acknowledgeLateCarrierActivity(
  shipmentId: string,
  note: string,
): Promise<AcknowledgementResult> {
  return parseAcknowledgement(
    await invokeEdgeJson('acknowledge-shipment-late-carrier-activity', {
      method: 'POST',
      body: { shipment_id: shipmentId, note },
    }),
  );
}
