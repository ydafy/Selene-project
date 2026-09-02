import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

import { verifyEnviaWebhook } from '../_shared/envia-webhook-verify.ts';
import { createEnviaWebhookHandler } from './handler.ts';

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
};

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
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
  claim: async ({ deliveryId, eventName, rawBody }) => {
    const payloadSha256 = await sha256(rawBody);
    const { data, error } = await supabaseAdmin
      .from('webhook_deliveries')
      .insert({
        provider: 'envia',
        delivery_id: deliveryId,
        event_name: eventName,
        payload_sha256: payloadSha256,
      })
      .select('id')
      .single();
    if (error?.code === '23505') {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('webhook_deliveries')
        .select('payload_sha256')
        .eq('provider', 'envia')
        .eq('delivery_id', deliveryId)
        .single();
      if (existingError || !existing) throw new Error('DELIVERY_CLAIM_FAILED');
      return existing.payload_sha256 === payloadSha256
        ? { kind: 'duplicate' as const }
        : { kind: 'collision' as const };
    }
    if (error || !data) throw new Error('DELIVERY_CLAIM_FAILED');
    return { kind: 'new' as const, id: data.id };
  },
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
  mark: async ({ deliveryId, state, errorCode }) => {
    const { error } = await supabaseAdmin
      .from('webhook_deliveries')
      .update({
        state,
        ...(state === 'processed'
          ? { processed_at: new Date().toISOString() }
          : { error_code: errorCode }),
      })
      .eq('id', deliveryId);
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

serve(handler);
