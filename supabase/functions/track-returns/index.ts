import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

import {
  buildPollingTrackingEvents,
  extractEnviaPollingObservations,
  successfulPollingTargetIds,
} from '../_shared/envia-tracking-ingestion.ts';
import { withSentry } from '../_shared/sentry.ts';

const BATCH_SIZE = 50;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

serve(withSentry('track-returns', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { data: disputes, error: fetchError } = await supabaseAdmin
      .from('disputes')
      .select('id, shipment_id, return_tracking_number')
      .in('status', ['waiting_return', 'return_shipped'])
      .not('return_tracking_number', 'is', null)
      .not('shipment_id', 'is', null)
      .order('return_last_tracked_at', { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);
    if (fetchError) throw fetchError;

    const targets = (disputes ?? []).flatMap((dispute) =>
      dispute.return_tracking_number && dispute.shipment_id
        ? [{ id: dispute.id, trackingNumber: dispute.return_tracking_number, shipmentId: dispute.shipment_id }]
        : [],
    );
    if (!targets.length) return json({ processed: 0, recorded: 0 });

    const mode = Deno.env.get('ENVIA_MODE') ?? 'sandbox';
    const apiKey = mode === 'production'
      ? Deno.env.get('ENVIA_API_KEY_PROD')
      : Deno.env.get('ENVIA_API_KEY_SANDBOX');
    const apiUrl = mode === 'production' ? 'https://api.envia.com' : 'https://api-test.envia.com';
    if (!apiKey) throw new Error('MISSING_ENVIA_API_KEY');

    const response = await fetch(`${apiUrl}/ship/generaltrack/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ trackingNumbers: [...new Set(targets.map((target) => target.trackingNumber))] }),
    });
    const payload = await response.json();
    if (!response.ok || payload?.meta === 'error' || !Array.isArray(payload?.data)) {
      throw new Error('ENVIA_TRACKING_REQUEST_FAILED');
    }

    const polledAt = new Date().toISOString();
    const events = buildPollingTrackingEvents(
      targets,
      payload.data.flatMap(extractEnviaPollingObservations),
      polledAt,
    );
    const pollingRunId = crypto.randomUUID();
    let recorded = 0;
    for (const event of events) {
      const dispute = targets.find((target) => target.id === event.targetId);
      if (!dispute) continue;
      const { data, error } = await supabaseAdmin.rpc('fn_record_tracking_event', {
        p_shipment_id: dispute.shipmentId,
        p_dispute_id: dispute.id,
        p_event_type: event.eventType,
        p_event_at: event.eventAt,
        p_raw_status: event.rawStatus,
        p_location: event.location,
        p_status_description: event.statusDescription,
        p_carrier_name: event.carrierName,
        p_webhook_delivery_id: null,
        p_polling_run_id: pollingRunId,
        p_transition: event.transition,
      });
      if (error) throw error;
      if ((data as { inserted?: boolean } | null)?.inserted) recorded += 1;
    }
    const trackedIds = successfulPollingTargetIds(targets);
    if (trackedIds.length) {
      const { error } = await supabaseAdmin
        .from('disputes')
        .update({ return_last_tracked_at: polledAt })
        .in('id', trackedIds);
      if (error) throw error;
    }
    return json({ processed: targets.length, recorded });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'TRACKING_RECONCILIATION_FAILED' }, 500);
  }
}));
