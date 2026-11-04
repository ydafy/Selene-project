import { useQuery } from '@tanstack/react-query';
import type { ShipmentTrackingEvent } from '@selene/types';

import { supabase } from '../db/supabase';
import { invokeEdge } from '../services/edge-client';

export const useShipmentTrackingEvents = (shipmentId: string | undefined) =>
  useQuery({
    queryKey: ['shipment-tracking-events', shipmentId],
    queryFn: async (): Promise<ShipmentTrackingEvent[]> => {
      if (!shipmentId) throw new Error('Shipment ID required');

      const { data, error } = await supabase
        .from('shipment_tracking_events')
        .select(
          'id, shipment_id, dispute_id, event_at, received_at, event_type, raw_status, status_description, location, carrier_name, webhook_delivery_id, polling_run_id',
        )
        .eq('shipment_id', shipmentId)
        .order('event_at', { ascending: true })
        .order('received_at', { ascending: true })
        .order('id', { ascending: true });

      if (error) throw error;
      return data as ShipmentTrackingEvent[];
    },
    enabled: !!shipmentId,
  });

export const useShipmentTrackingUrl = (shipmentId: string | undefined) =>
  useQuery({
    queryKey: ['shipment-tracking-url', shipmentId],
    queryFn: async () => {
      if (!shipmentId) throw new Error('Shipment ID required');
      return invokeEdge('resolve-shipment-tracking-url', { shipmentId });
    },
    enabled: !!shipmentId,
  });
