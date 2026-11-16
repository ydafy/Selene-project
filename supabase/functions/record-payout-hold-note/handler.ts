/**
 * @file supabase/functions/record-payout-hold-note/handler.ts
 *
 * Admin "keep holding" decision for an overdue held payout (#549): the shipment has been held
 * 30 days or more because the seller's Stripe account cannot be paid, and the admin records why
 * it stays on hold. It moves no money and changes no shipment, order or payout run; the RPC
 * appends a note and an `admin_audit_logs` row. Pure decision logic: the factory at the end wires
 * the Supabase auth, the `profiles_private` role and status lookup and the service-only RPC into
 * these ports. The admin id is the verified user, never the body. Raw database text only reaches
 * the log, and the note text is never logged.
 */

import type { SupabaseClient } from '../_shared/supabase-js.ts';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { isActiveAdmin } from '../_shared/auth/admin-auth.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The `shipment_payout_hold_notes.note` CHECK: 1 to 1000 characters after trimming. */
const MAX_NOTE_LENGTH = 1000;

export type RecordPayoutHoldNoteInput = {
  shipmentId: string;
  adminId: string;
  note: string;
};

export type RecordPayoutHoldNoteDeps = {
  /** The user id behind the access token, or null when it does not resolve to a user. */
  getUserId: (accessToken: string) => Promise<string | null>;
  /** True only for an active admin (see isActiveAdmin); throws when the lookup fails. */
  isAdmin: (userId: string) => Promise<boolean>;
  recordHoldNote: (
    input: RecordPayoutHoldNoteInput,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  log: (
    level: 'INFO' | 'WARN' | 'ERROR',
    msg: string,
    data?: Record<string, unknown>,
  ) => unknown;
};

export type RecordPayoutHoldNoteResult = {
  id: string;
  shipment_id: string;
  note: string;
  noted_at: string;
  noted_by: string;
};

const respond = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string): Response =>
  respond(status, { error: code });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * The trimmed note, or null when it is not 1 to 1000 characters. Length counts code points, as
 * SQL char_length does. String.prototype.trim strips a superset of the SQL btrim set, so the RPC
 * receives a note it stores unchanged.
 */
function parseNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const note = value.trim();
  const length = [...note].length;
  return length >= 1 && length <= MAX_NOTE_LENGTH ? note : null;
}

/** Stable code for the RPC errors a caller can act on; everything else is INTERNAL_ERROR. */
const RPC_ERRORS: readonly { sql: string; status: number; code: string }[] = [
  // The caller was an active admin a moment ago; the RPC re-checks it in the same transaction.
  { sql: 'ADMIN_REQUIRED', status: 403, code: 'ADMIN_ONLY' },
  { sql: 'INVALID_HOLD_NOTE', status: 422, code: 'INVALID_HOLD_NOTE' },
  { sql: 'SHIPMENT_NOT_FOUND', status: 404, code: 'SHIPMENT_NOT_FOUND' },
  { sql: 'PAYOUT_NOT_OVERDUE', status: 409, code: 'PAYOUT_NOT_OVERDUE' },
];

function mapRpcError(message: string): { status: number; code: string } | null {
  return RPC_ERRORS.find((e) => message.includes(e.sql)) ?? null;
}

function parseResult(
  data: unknown,
  shipmentId: string,
): RecordPayoutHoldNoteResult | null {
  const row = asRecord(data);
  if (
    !row ||
    typeof row.id !== 'string' ||
    !UUID.test(row.id) ||
    typeof row.shipment_id !== 'string' ||
    row.shipment_id.toLowerCase() !== shipmentId.toLowerCase() ||
    typeof row.admin_id !== 'string' ||
    !UUID.test(row.admin_id) ||
    typeof row.note !== 'string' ||
    typeof row.created_at !== 'string' ||
    Number.isNaN(Date.parse(row.created_at))
  ) {
    return null;
  }
  return {
    id: row.id,
    shipment_id: row.shipment_id,
    note: row.note,
    noted_at: row.created_at,
    noted_by: row.admin_id,
  };
}

export function createRecordPayoutHoldNoteHandler(
  deps: RecordPayoutHoldNoteDeps,
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
      const shipmentId = body?.shipment_id;
      if (typeof shipmentId !== 'string' || !UUID.test(shipmentId)) {
        return fail(422, 'INVALID_SHIPMENT_ID');
      }
      const note = parseNote(body?.note);
      if (note === null) return fail(422, 'INVALID_HOLD_NOTE');

      const { data, error } = await deps.recordHoldNote({
        shipmentId,
        adminId,
        note,
      });
      if (error) {
        deps.log('ERROR', 'Payout hold note failed', {
          shipmentId,
          error: error.message,
        });
        const mapped = mapRpcError(error.message);
        return mapped
          ? fail(mapped.status, mapped.code)
          : fail(500, 'INTERNAL_ERROR');
      }

      const result = parseResult(data, shipmentId);
      if (!result) {
        deps.log('ERROR', 'Payout hold note returned an unusable result', {
          shipmentId,
        });
        return fail(500, 'INTERNAL_ERROR');
      }

      deps.log('INFO', 'Payout hold note recorded', {
        shipmentId,
        adminId,
        noteId: result.id,
      });
      return respond(200, result);
    } catch (error: unknown) {
      deps.log('ERROR', 'Payout hold note crashed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(500, 'INTERNAL_ERROR');
    }
  };
}

/**
 * The real ports, all through the service-role client: Supabase Auth resolves the token, the
 * `profiles_private` role and status decide the admin (never JWT claims), and the service-only RPC
 * does the work.
 */
export function createSupabaseRecordPayoutHoldNotePorts(
  getAdmin: () => SupabaseClient<Database>,
): Omit<RecordPayoutHoldNoteDeps, 'log'> {
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
    recordHoldNote: async (input) => {
      const { data, error } = await getAdmin().rpc(
        'fn_admin_record_payout_hold_note',
        {
          p_admin_id: input.adminId,
          p_shipment_id: input.shipmentId,
          p_note: input.note,
        },
      );
      return { data: data as unknown, error };
    },
  };
}
