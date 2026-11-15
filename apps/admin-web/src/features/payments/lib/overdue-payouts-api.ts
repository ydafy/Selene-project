import {
  parseHoldNoteResult,
  parseOverdueRefundResult,
  type HoldNoteResult,
  type OverdueRefundResult,
} from '../logic/overdue-payouts';
import { invokeEdgeJson } from '@/shared/lib/edge-client';

/** Appends a hold note; the server trims and checks it again. */
export async function recordPayoutHoldNote(
  shipmentId: string,
  note: string,
): Promise<HoldNoteResult> {
  return parseHoldNoteResult(
    await invokeEdgeJson('record-payout-hold-note', {
      method: 'POST',
      body: { shipment_id: shipmentId, note },
    }),
  );
}

/** Only the shipment id is sent: the server computes the refund amount. */
export async function refundOverduePayout(
  shipmentId: string,
): Promise<OverdueRefundResult> {
  return parseOverdueRefundResult(
    await invokeEdgeJson('refund-overdue-payout', {
      method: 'POST',
      body: { shipment_id: shipmentId },
    }),
  );
}
