/**
 * @file supabase/functions/envia-webhook/delivery-ports.ts
 *
 * The delivery inbox ports of the Envia webhook. `internal.webhook_deliveries` is not
 * exposed through PostgREST, so a delivery is claimed and marked only through the
 * service-only RPCs `fn_claim_envia_webhook_delivery` and `fn_mark_webhook_delivery`.
 */
import type { EnviaWebhookHandlerDependencies } from './handler.ts';

type RpcError = { code?: string; message: string } | null;

/** The part of the service-role supabase-js client these ports use. */
export type DeliveryRpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: RpcError }>;
};

/** Lowercase hex SHA-256 of the raw request body; a redelivery must match it. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function createWebhookDeliveryPorts(
  admin: DeliveryRpcClient,
): Pick<EnviaWebhookHandlerDependencies, 'claim' | 'mark'> {
  return {
    claim: async ({ deliveryId, eventName, rawBody }) => {
      const { data, error } = await admin.rpc(
        'fn_claim_envia_webhook_delivery',
        {
          p_delivery_id: deliveryId,
          p_event_name: eventName,
          p_payload_sha256: await sha256Hex(rawBody),
        },
      );
      const row = Array.isArray(data) ? asRecord(data[0]) : null;
      if (error || !row) throw new Error('DELIVERY_CLAIM_FAILED');
      if (row.kind === 'new' && typeof row.id === 'string') {
        return { kind: 'new' as const, id: row.id };
      }
      if (row.kind === 'duplicate') return { kind: 'duplicate' as const };
      if (row.kind === 'collision') return { kind: 'collision' as const };
      throw new Error('DELIVERY_CLAIM_FAILED');
    },
    mark: async ({ deliveryId, state, errorCode }) => {
      const { error } = await admin.rpc('fn_mark_webhook_delivery', {
        p_delivery_id: deliveryId,
        p_state: state,
        p_error_code: state === 'failed' ? (errorCode ?? null) : null,
      });
      if (error) throw error;
    },
  };
}
