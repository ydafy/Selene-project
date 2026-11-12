import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';

import { verifyEnviaWebhook } from '../_shared/envia/envia-webhook-verify.ts';
import { createEnviaWebhookHandler } from './handler.ts';
import { createWebhookDeliveryPorts } from './delivery-ports.ts';
import { withSentry } from '../_shared/sentry.ts';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  readSupabaseSecretKey() ?? '',
);

const mode = Deno.env.get('ENVIA_MODE') ?? 'sandbox';
const webhookSecret =
  mode === 'production'
    ? Deno.env.get('ENVIA_WEBHOOK_SECRET_PROD')
    : Deno.env.get('ENVIA_WEBHOOK_SECRET_SANDBOX');

const handler = createEnviaWebhookHandler({
  verify: ({ headers, rawBody }) =>
    verifyEnviaWebhook({
      headers,
      rawBody,
      secret: webhookSecret ?? '',
    }),
  ...createWebhookDeliveryPorts(supabaseAdmin),
  resolveSubject: async (trackingNumber) => {
    const [shipments, disputes] = await Promise.all([
      supabaseAdmin
        .from('shipments')
        .select('id')
        .eq('tracking_number', trackingNumber),
      supabaseAdmin
        .from('disputes')
        .select('id, shipment_id')
        .eq('return_tracking_number', trackingNumber),
    ]);
    if (shipments.error || disputes.error) {
      throw new Error('TRACKING_SUBJECT_LOOKUP_FAILED');
    }
    const candidates = [
      ...(shipments.data ?? []).map((shipment) => ({
        shipmentId: shipment.id,
        disputeId: null,
      })),
      ...(disputes.data ?? [])
        .filter((dispute) => dispute.shipment_id)
        .map((dispute) => ({
          shipmentId: dispute.shipment_id as string,
          disputeId: dispute.id,
        })),
    ];
    return candidates.length === 1 ? candidates[0] : null;
  },
  record: async ({ shipmentId, disputeId, deliveryId, event }) => {
    const { error } = await supabaseAdmin.rpc('fn_record_tracking_event', {
      p_shipment_id: shipmentId,
      p_dispute_id: disputeId,
      p_event_type: event.eventType,
      p_event_at: event.eventAt,
      p_raw_status: event.rawStatus,
      p_location: event.location,
      p_status_description: event.statusDescription,
      p_carrier_name: event.carrierName,
      p_webhook_delivery_id: deliveryId,
      p_polling_run_id: null,
      p_transition: event.transition,
    });
    if (error) throw error;
  },
  schedule: async (work) => {
    const edgeRuntime = (
      globalThis as typeof globalThis & {
        EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void };
      }
    ).EdgeRuntime;
    const processing = work();
    if (edgeRuntime) edgeRuntime.waitUntil(processing);
    else await processing;
  },
});

Deno.serve(withSentry('envia-webhook', handler));
