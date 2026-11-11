/**
 * @file supabase/functions/acknowledge-shipment-late-carrier-activity/handler.ts
 *
 * Admin acknowledgement of carrier activity recorded after a cancellation refund started (B5.8b).
 * The cancellation has already completed; this only records that an admin looked at the package
 * that moved, with a required note. It starts no refund, changes no shipment or order and calls
 * neither Stripe nor Envia. Pure decision logic: the factory at the end wires the Supabase auth,
 * the `profiles_private.role` lookup and the service-only RPC into these ports. The admin id is
 * the verified user, never the body. A repeat returns the stored acknowledgement. Raw database
 * text only reaches the log, and the note text is never logged.
 */

import type { SupabaseClient } from '../_shared/supabase-js.ts';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { isActiveAdmin } from '../_shared/auth/admin-auth.ts';
import { z } from '../_shared/zod-runtime.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE_LENGTH = 200;

const shipmentIdSchema = z.string().regex(UUID);
const noteSchema = z.string().trim().min(1).max(MAX_NOTE_LENGTH);

export type AcknowledgeShipmentLateCarrierActivityInput = {
  shipmentId: string;
  adminId: string;
  note: string;
};

export type AcknowledgeShipmentLateCarrierActivityDeps = {
  /** The user id behind the access token, or null when it does not resolve to a user. */
  getUserId: (accessToken: string) => Promise<string | null>;
  /** True only for an active admin (see isActiveAdmin); throws when the lookup fails. */
  isAdmin: (userId: string) => Promise<boolean>;
  acknowledge: (
    input: AcknowledgeShipmentLateCarrierActivityInput,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  log: (
    level: 'INFO' | 'WARN' | 'ERROR',
    msg: string,
    data?: Record<string, unknown>,
  ) => unknown;
};

const respond = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string): Response =>
  respond(status, { error: code });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Stable code for the RPC errors a caller can act on; everything else is INTERNAL_ERROR. */
const RPC_ERRORS: readonly { sql: string; status: number; code: string }[] = [
  { sql: 'ADMIN_REQUIRED', status: 403, code: 'ADMIN_ONLY' },
  { sql: 'SHIPMENT_NOT_FOUND', status: 404, code: 'SHIPMENT_NOT_FOUND' },
  {
    sql: 'LATE_CARRIER_ACTIVITY_NOT_FOUND',
    status: 404,
    code: 'LATE_CARRIER_ACTIVITY_NOT_FOUND',
  },
  {
    sql: 'INVALID_ACKNOWLEDGEMENT_NOTE',
    status: 422,
    code: 'INVALID_ACKNOWLEDGEMENT_NOTE',
  },
];

function mapRpcError(message: string): { status: number; code: string } | null {
  return RPC_ERRORS.find((e) => message.includes(e.sql)) ?? null;
}

function parseResult(data: unknown): Record<string, unknown> | null {
  const result = asRecord(data);
  if (!result) return null;
  const acknowledgedAt =
    typeof result.acknowledged_at === 'string'
      ? new Date(result.acknowledged_at)
      : null;
  if (
    !acknowledgedAt ||
    Number.isNaN(acknowledgedAt.getTime()) ||
    typeof result.acknowledged_by !== 'string' ||
    result.acknowledged_by === '' ||
    typeof result.acknowledged_note !== 'string' ||
    typeof result.already_acknowledged !== 'boolean'
  ) {
    return null;
  }
  return {
    acknowledged_at: result.acknowledged_at,
    acknowledged_by: result.acknowledged_by,
    acknowledged_note: result.acknowledged_note,
    already_acknowledged: result.already_acknowledged,
  };
}

export function createAcknowledgeShipmentLateCarrierActivityHandler(
  deps: AcknowledgeShipmentLateCarrierActivityDeps,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED');

    try {
      const authorization = req.headers.get('Authorization') ?? '';
      const token = authorization.startsWith('Bearer ')
        ? authorization.slice(7).trim()
        : '';
      if (!token) return fail(401, 'AUTH_REQUIRED');

      const adminId = await deps.getUserId(token);
      if (!adminId) return fail(401, 'AUTH_REQUIRED');

      if (!(await deps.isAdmin(adminId))) return fail(403, 'ADMIN_ONLY');

      const body = asRecord(await req.json().catch(() => null));
      const shipmentId = shipmentIdSchema.safeParse(body?.shipment_id);
      if (!shipmentId.success) return fail(422, 'INVALID_SHIPMENT_ID');
      const note = noteSchema.safeParse(body?.note);
      if (!note.success) return fail(422, 'INVALID_ACKNOWLEDGEMENT_NOTE');

      const { data, error } = await deps.acknowledge({
        shipmentId: shipmentId.data,
        adminId,
        note: note.data,
      });
      if (error) {
        deps.log(
          'ERROR',
          'Shipment late carrier activity acknowledgement failed',
          {
            shipmentId: shipmentId.data,
            error: error.message,
          },
        );
        const mapped = mapRpcError(error.message);
        return mapped
          ? fail(mapped.status, mapped.code)
          : fail(500, 'INTERNAL_ERROR');
      }

      const result = parseResult(data);
      if (!result) {
        deps.log(
          'ERROR',
          'Shipment late carrier activity acknowledgement returned an unusable result',
          {
            shipmentId: shipmentId.data,
          },
        );
        return fail(500, 'INTERNAL_ERROR');
      }

      deps.log('INFO', 'Shipment late carrier activity acknowledged', {
        shipmentId: shipmentId.data,
        adminId,
        alreadyAcknowledged: result.already_acknowledged,
      });
      return respond(200, result);
    } catch (error: unknown) {
      deps.log(
        'ERROR',
        'Shipment late carrier activity acknowledgement crashed',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return fail(500, 'INTERNAL_ERROR');
    }
  };
}

/**
 * The real ports, all through the service-role client: Supabase Auth resolves the token, the
 * `profiles_private` role and status decide the admin (never JWT claims), and the service-only RPC
 * does the work.
 */
export function createSupabaseAcknowledgeShipmentLateCarrierActivityPorts(
  getAdmin: () => SupabaseClient<Database>,
): Omit<AcknowledgeShipmentLateCarrierActivityDeps, 'log'> {
  return {
    getUserId: async (accessToken) => {
      const {
        data: { user },
        error,
      } = await getAdmin().auth.getUser(accessToken);
      return error || !user ? null : user.id;
    },
    // Roles live in profiles_private.role, never in JWT claims.
    isAdmin: async (userId) => {
      const { data, error } = await getAdmin()
        .from('profiles_private')
        .select('role, status')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return isActiveAdmin(data);
    },
    acknowledge: async (input) => {
      // The RPC is not in the generated types until `bun run db:types` runs after it is applied.
      const { data, error } = await getAdmin().rpc(
        'fn_acknowledge_shipment_late_carrier_activity' as never,
        {
          p_shipment_id: input.shipmentId,
          p_admin_id: input.adminId,
          p_note: input.note,
        } as never,
      );
      return { data: data as unknown, error };
    },
  };
}
