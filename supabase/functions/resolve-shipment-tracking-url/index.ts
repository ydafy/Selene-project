import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

import { resolveEnviaTrackingUrl } from '../_shared/envia-tracking.ts';
import {
  createResolveShipmentTrackingUrlHandler,
  type TrackingUrlSubject,
} from './handler.ts';
import { ShipmentTrackingUrlRequestSchema } from './request-schema.ts';
import { withSentry } from '../_shared/sentry.ts';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const handler = createResolveShipmentTrackingUrlHandler({
  authenticate: async (request) => {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    return error || !data.user ? null : { id: data.user.id };
  },
  loadSubject: async (shipmentId) => {
    const { data, error } = await supabaseAdmin
      .from('shipments')
      .select('seller_id, tracking_number, order:orders(buyer_id)')
      .eq('id', shipmentId)
      .single();
    if (error || !data) return null;

    const subject = data as unknown as {
      seller_id: string;
      tracking_number: string | null;
      order: { buyer_id: string } | null;
    };
    if (!subject.order) return null;
    return {
      sellerId: subject.seller_id,
      buyerId: subject.order.buyer_id,
      trackingNumber: subject.tracking_number,
    } satisfies TrackingUrlSubject;
  },
  loadRole: async (userId) => {
    const { data } = await supabaseAdmin
      .from('profiles_private')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    return data?.role ?? null;
  },
  resolveUrl: (trackingNumber) =>
    resolveEnviaTrackingUrl(Deno.env.get('ENVIA_MODE') ?? 'sandbox', trackingNumber),
});

serve(withSentry('resolve-shipment-tracking-url', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok');

  const body = await request.clone().json().catch(() => null);
  if (!ShipmentTrackingUrlRequestSchema.safeParse(body).success) {
    return new Response(JSON.stringify({ error: 'INVALID_SHIPMENT_ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return handler(request);
}));
