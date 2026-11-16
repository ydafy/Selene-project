/**
 * @file supabase/functions/purge-old-evidence/handler.ts
 *
 * Cron purge of old dispute, return and packing evidence (ops-cron-storage S5, #29).
 * Supabase blocks deleting `storage.objects` from SQL, so the objects go through the
 * Storage API. `fn_list_evidence_purge_candidates` owns the retention rule (120 days
 * after the order closed, never with an open dispute); for each listed order this
 * worker removes its objects and then calls `fn_mark_evidence_purged`, which stamps
 * `orders.evidence_purged_at` only once no object of the order remains. An order that
 * fails stays unmarked and is listed again on the next run, so a rerun finishes it.
 *
 * Authenticated by the `x-cron-secret` header against `CRON_SECRET`.
 *
 * Responses:
 *   200 { orders, removed, marked, failed }
 *   401 { error: 'CRON_UNAUTHORIZED' }   missing or wrong secret
 *   405 { error: 'METHOD_NOT_ALLOWED' }
 *   500 { error: 'INTERNAL_ERROR' }      the candidate list failed (reported to Sentry as a 5xx)
 */
import type { SupabaseClient } from '../_shared/supabase-js.ts';
import { z } from '../_shared/zod-runtime.ts';

import type { Database } from '../../../packages/types/src/database.types.ts';
import { safeErrorCode } from '../_shared/account-closure-cleanup.ts';
import {
  isAuthorizedCronRequest,
  reportCronSecretMismatch,
  type CronMismatchReporter,
} from '../_shared/auth/cron-auth.ts';

/** Orders per run. A daily run of 50 orders stays far below the function time limit. */
export const BATCH_SIZE = 50;
/** Paths per Storage API remove call. */
export const STORAGE_PAGE_SIZE = 100;
const EVIDENCE_BUCKET = 'evidence';
const FUNCTION_NAME = 'purge-old-evidence';

type DbError = { code?: string; message: string } | null;

export type PurgeOldEvidenceDeps = {
  getCronSecret: () => string | undefined;
  /** Sentry message reporter (`reportMessage` from `_shared/sentry.ts`); failures never reach the caller. */
  reportMessage: CronMismatchReporter;
  log: (
    level: 'INFO' | 'WARN' | 'ERROR',
    msg: string,
    data?: Record<string, unknown>,
  ) => void;
  listCandidates: (
    limit: number,
  ) => Promise<{ data: unknown[] | null; error: DbError }>;
  /** Removes the given evidence paths; resolves to how many Storage removed, throws on error. */
  removeObjects: (paths: string[]) => Promise<number>;
  markPurged: (
    orderId: string,
  ) => Promise<{ data: boolean | null; error: DbError }>;
};

const CandidateSchema = z.object({
  order_id: z.uuid(),
  object_names: z.array(z.string().min(1)),
});

type Failure = { step: 'parse' | 'remove' | 'mark'; code: string };

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export function createPurgeOldEvidenceHandler(deps: PurgeOldEvidenceDeps) {
  /** Best effort: a failing reporter never changes the response or aborts the run. */
  async function reportFailure(
    failure: Failure,
    firstOrderId: string,
    count: number,
  ): Promise<void> {
    try {
      await deps.reportMessage(`${FUNCTION_NAME} order failed`, {
        fingerprint: [
          'purge-old-evidence-order-failed',
          failure.step,
          failure.code,
        ],
        tags: {
          edge_function: FUNCTION_NAME,
          step: failure.step,
          code: failure.code,
          order_id: firstOrderId,
          failed: String(count),
        },
      });
    } catch {
      // Alerting is best effort.
    }
  }

  /** Removes the order's objects page by page, then marks it. Returns the failure, if any. */
  async function purgeOrder(
    orderId: string,
    names: string[],
    summary: { removed: number },
  ): Promise<Failure | null> {
    for (let start = 0; start < names.length; start += STORAGE_PAGE_SIZE) {
      try {
        summary.removed += await deps.removeObjects(
          names.slice(start, start + STORAGE_PAGE_SIZE),
        );
      } catch (error: unknown) {
        // Storage error text can carry paths; only a machine code leaves here.
        return { step: 'remove', code: safeErrorCode(error) };
      }
    }
    try {
      const { data, error } = await deps.markPurged(orderId);
      if (error) return { step: 'mark', code: safeDbCode(error) };
      return data === true ? null : { step: 'mark', code: 'not_marked' };
    } catch (error: unknown) {
      return { step: 'mark', code: safeErrorCode(error) };
    }
  }

  return async (req: Request): Promise<Response> => {
    if (!isAuthorizedCronRequest(req, deps.getCronSecret())) {
      await reportCronSecretMismatch(req, FUNCTION_NAME, deps.reportMessage);
      return json({ error: 'CRON_UNAUTHORIZED' }, 401);
    }
    if (req.method !== 'POST') {
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    }

    try {
      const { data, error } = await deps.listCandidates(BATCH_SIZE);
      if (error || !data) {
        // The database error text is not forwarded or logged.
        deps.log('ERROR', 'Evidence purge candidates could not be listed', {
          code: error?.code,
        });
        return json({ error: 'INTERNAL_ERROR' }, 500);
      }

      const summary = { orders: data.length, removed: 0, marked: 0, failed: 0 };
      // Each distinct failure is reported once after the batch, with its first order and count.
      const failures = new Map<
        string,
        { failure: Failure; firstOrderId: string; count: number }
      >();
      for (const row of data) {
        const parsed = CandidateSchema.safeParse(row);
        const orderId = parsed.success ? parsed.data.order_id : 'unknown';
        const failure = parsed.success
          ? await purgeOrder(orderId, parsed.data.object_names, summary)
          : ({ step: 'parse', code: 'invalid_row' } as const);
        if (!failure) {
          summary.marked += 1;
          continue;
        }
        summary.failed += 1;
        deps.log('WARN', 'Evidence purge failed for an order', {
          orderId,
          step: failure.step,
          code: failure.code,
        });
        const key = `${failure.step}:${failure.code}`;
        const entry = failures.get(key);
        if (entry) entry.count += 1;
        else failures.set(key, { failure, firstOrderId: orderId, count: 1 });
      }
      for (const { failure, firstOrderId, count } of failures.values()) {
        await reportFailure(failure, firstOrderId, count);
      }

      deps.log('INFO', 'Evidence purge run finished', summary);
      return json(summary, 200);
    } catch (error: unknown) {
      deps.log('ERROR', 'Evidence purge run crashed', {
        code: safeErrorCode(error),
      });
      return json({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}

/** A Postgres SQLSTATE or PostgREST code (`57014`, `PGRST202`); anything else is 'error'. */
function safeDbCode(error: { code?: string }): string {
  return typeof error.code === 'string' &&
    /^[A-Za-z0-9_]{1,16}$/.test(error.code)
    ? error.code
    : 'error';
}

/** The real ports: the two service-only RPCs and the Storage API through the service-role client. */
export function createSupabasePurgeOldEvidencePorts(deps: {
  getAdmin: () => SupabaseClient<Database>;
}): Pick<
  PurgeOldEvidenceDeps,
  'listCandidates' | 'removeObjects' | 'markPurged'
> {
  return {
    listCandidates: async (limit) => {
      return await deps
        .getAdmin()
        .rpc('fn_list_evidence_purge_candidates', { p_limit: limit });
    },
    removeObjects: async (paths) => {
      const { data, error } = await deps
        .getAdmin()
        .storage.from(EVIDENCE_BUCKET)
        .remove(paths);
      if (error) throw new Error('STORAGE_REMOVE_FAILED');
      return data?.length ?? 0;
    },
    markPurged: async (orderId) => {
      return await deps
        .getAdmin()
        .rpc('fn_mark_evidence_purged', { p_order_id: orderId });
    },
  };
}
