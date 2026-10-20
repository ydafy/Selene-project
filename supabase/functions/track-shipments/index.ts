import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

import { extractEnviaPollingObservations } from '../_shared/envia-tracking-ingestion.ts';
import {
  createTrackShipmentsHandler,
  type TrackShipmentsDependencies,
} from './handler.ts';

const BATCH_SIZE = 50;
const TRACKING_DEADLINE_MS = 90_000;
const POLLING_INTERVALS = {
  preparing: 5 * 60 * 1000,
  shipped: 15 * 60 * 1000,
} as const;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === 'object';

const isInvalidPollingResponse = (value: unknown): boolean => {
  if (!isRecord(value)) return true;

  const history = value.history ?? value.events;
  const observations = Array.isArray(history) ? history : [value];
  return observations.some(
    (observation) =>
      !isRecord(observation) ||
      !Object.hasOwn(observation, 'status') ||
      typeof observation.status !== 'string' ||
      observation.status.trim().length === 0,
  );
};

const createDeadline = () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRACKING_DEADLINE_MS);
  return { signal: controller.signal, dispose: () => clearTimeout(timeout) };
};

const createDependencies = (): TrackShipmentsDependencies => ({
  acquireLease: async (lane) => {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { data, error } = await supabaseAdmin.rpc(
      'fn_acquire_track_shipments_lease',
      { p_lane: lane },
    );
    if (error) throw error;

    const lease = Array.isArray(data) ? data[0] : data;
    if (!lease) throw new Error('TRACKING_LEASE_ACQUIRE_FAILED');
    return {
      acquired: Boolean(lease.acquired),
      leaseId: lease.lease_id ?? undefined,
    };
  },
  releaseLease: async (lane, leaseId) => {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { error } = await supabaseAdmin.rpc(
      'fn_release_track_shipments_lease',
      { p_lane: lane, p_lease_id: leaseId },
    );
    if (error) throw error;
  },
  selectTargets: async (status, signal) => {
    if (signal.aborted) throw new Error('TRACKING_DEADLINE_EXCEEDED');
    const dueAt = new Date(
      Date.now() - POLLING_INTERVALS[status],
    ).toISOString();
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { data: shipments, error: fetchError } = await supabaseAdmin
      .from('shipments')
      .select('id, tracking_number')
      .eq('status', status)
      .not('tracking_number', 'is', null)
      .or(`last_tracked_at.is.null,last_tracked_at.lte.${dueAt}`)
      .order('last_tracked_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);
    if (fetchError) throw fetchError;
    if (signal.aborted) throw new Error('TRACKING_DEADLINE_EXCEEDED');
    return (shipments ?? []).flatMap((shipment) =>
      shipment.tracking_number
        ? [{ id: shipment.id, trackingNumber: shipment.tracking_number }]
        : [],
    );
  },
  fetchObservations: async (trackingNumbers, signal) => {
    const mode = Deno.env.get('ENVIA_MODE') ?? 'sandbox';
    const apiKey =
      mode === 'production'
        ? Deno.env.get('ENVIA_API_KEY_PROD')
        : Deno.env.get('ENVIA_API_KEY_SANDBOX');
    const apiUrl =
      mode === 'production'
        ? 'https://api.envia.com'
        : 'https://api-test.envia.com';
    if (!apiKey) throw new Error('MISSING_ENVIA_API_KEY');

    const response = await fetch(`${apiUrl}/ship/generaltrack/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ trackingNumbers }),
      signal,
    });
    const payload: unknown = await response.json();
    const data =
      payload && typeof payload === 'object'
        ? (payload as { data?: unknown }).data
        : undefined;
    const meta =
      payload && typeof payload === 'object'
        ? (payload as { meta?: unknown }).meta
        : undefined;
    if (!response.ok || meta === 'error' || !Array.isArray(data)) {
      throw new Error('ENVIA_TRACKING_REQUEST_FAILED');
    }
    if (data.some(isInvalidPollingResponse)) {
      throw new Error('ENVIA_TRACKING_INVALID_RESPONSE');
    }
    return data.flatMap(extractEnviaPollingObservations);
  },
  record: async (event, pollingRunId) => {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { data, error } = await supabaseAdmin.rpc(
      'fn_record_tracking_event',
      {
        p_shipment_id: event.targetId,
        p_dispute_id: null,
        p_event_type: event.eventType,
        p_event_at: event.eventAt,
        p_raw_status: event.rawStatus,
        p_location: event.location,
        p_status_description: event.statusDescription,
        p_carrier_name: event.carrierName,
        p_webhook_delivery_id: null,
        p_polling_run_id: pollingRunId,
        p_transition: event.transition,
      },
    );
    if (error) throw error;
    return {
      inserted: Boolean((data as { inserted?: boolean } | null)?.inserted),
    };
  },
  markTracked: async (targetIds, trackedAt) => {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { error } = await supabaseAdmin
      .from('shipments')
      .update({ last_tracked_at: trackedAt })
      .in('id', targetIds);
    if (error) throw error;
  },
});

serve(
  createTrackShipmentsHandler({
    secret: Deno.env.get('TRACK_SHIPMENTS_CRON_SECRET'),
    pollingEnabled: Deno.env.get('TRACK_SHIPMENTS_POLLING_ENABLED'),
    dependencies: createDependencies(),
    now: () => new Date(),
    createDeadline,
  }),
);
