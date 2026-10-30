/**
 * @file supabase/functions/dispatch-push/handler.ts
 *
 * Cron worker (every minute) that delivers queued push notifications through the Expo Push API
 * (expo-push-notifications S1, S3, S7). Each run, in order:
 *   1. Send: up to 5 times, claims 100 rows with `fn_claim_push_deliveries` and sends them right
 *      away (the claim is the last point where a token can still belong to another account),
 *      then records the tickets with `fn_record_push_results`.
 *   2. Receipts: checks the receipts that are due and records them; a dead token is disabled.
 *   3. Purge: deletes old finished rows.
 * Authenticated by the `x-cron-secret` header, like cron-watchdog. Nothing sensitive (tokens,
 * titles, bodies, provider text) is logged or stored; failures are short machine codes.
 *
 * Responses:
 *   200 { claimed, sent, retry, failed, ignored, receipts: { checked, ok, error, missing,
 *         pending, tokens_disabled }, purged }
 *   401 { error: 'CRON_UNAUTHORIZED' }       missing or wrong secret
 *   405 { error: 'METHOD_NOT_ALLOWED' }
 *   500 { error: 'MISSING_SERVER_CONFIG' }   no EXPO_ACCESS_TOKEN; nothing was claimed
 *   500 { error: 'INTERNAL_ERROR' }          the claim failed (reported to Sentry as a 5xx)
 */
import {
  isAuthorizedCronRequest,
  reportCronSecretMismatch,
  type CronMismatchReporter,
} from '../_shared/cron-auth.ts';
import { getPushReceipts, sendPushMessages, type ExpoMessage } from './expo.ts';

/** Rows per Expo request (the API limit). */
export const CLAIM_SIZE = 100;
/** Batches per run, so a run stays far below the function time limit. */
export const MAX_BATCHES = 5;
/** Receipt ids per getReceipts request (the API limit). */
export const RECEIPT_LIMIT = 1000;
export const PURGE_LIMIT = 5000;
/** Matches the claim's max age (6 hours): Expo drops a message the device could not take by then. */
const TTL_SECONDS = 6 * 60 * 60;
const FUNCTION_NAME = 'dispatch-push';
/** Ticket and request errors that mean the Expo credentials or configuration are wrong. */
const CREDENTIAL_CODES = new Set([
  'InvalidCredentials',
  'MismatchSenderId',
  'UNAUTHORIZED',
  'expo_http_401',
  'expo_http_403',
]);

type DbError = { code?: string; message: string } | null;
type DbResult<T> = Promise<{ data: T | null; error: DbError }>;

export type ClaimedDelivery = {
  delivery_id: string;
  claim_token: string;
  expo_token: string;
  platform: string;
  channel: string;
  title: string;
  message: string | null;
  action_path: string | null;
  notification_id: string;
  event_kind: string;
};

type PushResult = {
  id: string;
  claim_token: string;
  outcome: 'sent' | 'retry' | 'failed';
  ticket_id?: string;
  error?: string;
  token_dead?: true;
};

type PushReceiptRecord = {
  id: string;
  receipt: 'ok' | 'error' | 'missing';
  error?: string;
  token_dead?: true;
};

export type DispatchPushDeps = {
  getCronSecret: () => string | undefined;
  getExpoAccessToken: () => string | undefined;
  fetch: typeof fetch;
  /** Sentry message reporter (`reportMessage` from `_shared/sentry.ts`); failures never reach the caller. */
  reportMessage: CronMismatchReporter;
  log: (
    level: 'INFO' | 'WARN' | 'ERROR',
    msg: string,
    data?: Record<string, unknown>,
  ) => void;
  claimDeliveries: (limit: number) => DbResult<ClaimedDelivery[]>;
  recordResults: (results: PushResult[]) => DbResult<unknown>;
  listReceiptsDue: (
    limit: number,
  ) => DbResult<{ delivery_id: string; ticket_id: string }[]>;
  recordReceipts: (receipts: PushReceiptRecord[]) => DbResult<unknown>;
  purgeDeliveries: (limit: number) => DbResult<number>;
};

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Counts come back as a json object (or a one-row array); anything else counts as zero. */
function readCounts<K extends string>(
  data: unknown,
  keys: readonly K[],
): Record<K, number> {
  const source = Array.isArray(data) ? data[0] : data;
  const record =
    typeof source === 'object' && source !== null
      ? (source as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    keys.map((key) => [key, typeof record[key] === 'number' ? record[key] : 0]),
  ) as Record<K, number>;
}

const toMessage = (row: ClaimedDelivery): ExpoMessage => ({
  to: row.expo_token,
  title: row.title,
  ...(row.message === null ? {} : { body: row.message }),
  data: {
    notification_id: row.notification_id,
    action_path: row.action_path,
    event_kind: row.event_kind,
  },
  channelId: row.channel,
  sound: 'default',
  priority: 'high',
  ttl: TTL_SECONDS,
});

export function createDispatchPushHandler(deps: DispatchPushDeps) {
  /** Best effort: a failing reporter never changes the response or aborts the run. */
  async function reportCredentialProblem(code: string): Promise<void> {
    try {
      await deps.reportMessage(`${FUNCTION_NAME} Expo credentials rejected`, {
        fingerprint: ['dispatch-push-credentials', code],
        tags: { edge_function: FUNCTION_NAME, code },
      });
    } catch {
      // Alerting is best effort.
    }
  }

  /** Remembers a code for the end-of-run Sentry report when it points at the credentials. */
  const noteCode = (code: string, credentialCodes: Set<string>) => {
    if (CREDENTIAL_CODES.has(code)) credentialCodes.add(code);
  };

  async function sendPhase(credentialCodes: Set<string>, accessToken: string) {
    const totals = { claimed: 0, sent: 0, retry: 0, failed: 0, ignored: 0 };
    for (let batchNumber = 0; batchNumber < MAX_BATCHES; batchNumber += 1) {
      const { data: rows, error } = await deps.claimDeliveries(CLAIM_SIZE);
      if (error || !rows) {
        // The database error text is not forwarded or logged.
        deps.log('ERROR', 'Push claim failed', { code: error?.code });
        return null;
      }
      if (rows.length === 0) break;
      totals.claimed += rows.length;

      const sent = await sendPushMessages(
        deps.fetch,
        accessToken,
        rows.map(toMessage),
      );
      let results: PushResult[];
      if (!sent.ok) {
        deps.log('WARN', 'Expo send request failed', {
          code: sent.code,
          rows: rows.length,
        });
        noteCode(sent.code, credentialCodes);
        results = rows.map((row) => ({
          id: row.delivery_id,
          claim_token: row.claim_token,
          outcome: 'retry',
          error: sent.code,
        }));
      } else {
        results = rows.map((row, index): PushResult => {
          const ticket = sent.data[index]!;
          const base = { id: row.delivery_id, claim_token: row.claim_token };
          if (ticket.ok)
            return { ...base, outcome: 'sent', ticket_id: ticket.id };
          noteCode(ticket.code, credentialCodes);
          if (ticket.code === 'DeviceNotRegistered') {
            return {
              ...base,
              outcome: 'failed',
              error: ticket.code,
              token_dead: true,
            };
          }
          if (ticket.code === 'MessageTooBig') {
            return { ...base, outcome: 'failed', error: ticket.code };
          }
          return { ...base, outcome: 'retry', error: ticket.code };
        });
      }

      try {
        const recorded = await deps.recordResults(results);
        if (recorded.error || recorded.data === null) {
          // Rows stay `sending`; the lease expires and the next run claims them again.
          deps.log('ERROR', 'Push results could not be recorded', {
            code: recorded.error?.code,
            rows: rows.length,
          });
        } else {
          const counts = readCounts(recorded.data, [
            'sent',
            'retry',
            'failed',
            'ignored',
          ] as const);
          for (const key of ['sent', 'retry', 'failed', 'ignored'] as const) {
            totals[key] += counts[key];
          }
        }
      } catch {
        deps.log('ERROR', 'Push results could not be recorded', {
          rows: rows.length,
        });
      }

      if (rows.length < CLAIM_SIZE) break;
    }
    return totals;
  }

  async function receiptsPhase(
    credentialCodes: Set<string>,
    accessToken: string,
  ) {
    const summary = {
      checked: 0,
      ok: 0,
      error: 0,
      missing: 0,
      pending: 0,
      tokens_disabled: 0,
    };
    try {
      const { data: due, error } = await deps.listReceiptsDue(RECEIPT_LIMIT);
      if (error || !due) {
        deps.log('ERROR', 'Due push receipts could not be listed', {
          code: error?.code,
        });
        return summary;
      }
      if (due.length === 0) return summary;

      const fetched = await getPushReceipts(
        deps.fetch,
        accessToken,
        due.map((row) => row.ticket_id),
      );
      if (!fetched.ok) {
        // Nothing is recorded: the rows stay due and the next run asks again.
        deps.log('WARN', 'Expo receipts request failed', {
          code: fetched.code,
          rows: due.length,
        });
        noteCode(fetched.code, credentialCodes);
        return summary;
      }

      const records = due.map((row): PushReceiptRecord => {
        const receipt = fetched.data.get(row.ticket_id);
        if (!receipt) return { id: row.delivery_id, receipt: 'missing' };
        if (receipt.ok) return { id: row.delivery_id, receipt: 'ok' };
        noteCode(receipt.code, credentialCodes);
        return {
          id: row.delivery_id,
          receipt: 'error',
          error: receipt.code,
          ...(receipt.code === 'DeviceNotRegistered'
            ? { token_dead: true as const }
            : {}),
        };
      });

      const recorded = await deps.recordReceipts(records);
      if (recorded.error || recorded.data === null) {
        deps.log('ERROR', 'Push receipts could not be recorded', {
          code: recorded.error?.code,
          rows: records.length,
        });
        return summary;
      }
      return {
        checked: records.length,
        ...readCounts(recorded.data, [
          'ok',
          'error',
          'missing',
          'pending',
          'tokens_disabled',
        ] as const),
      };
    } catch {
      deps.log('ERROR', 'Push receipts phase crashed');
      return summary;
    }
  }

  async function purgePhase(): Promise<number> {
    try {
      const { data, error } = await deps.purgeDeliveries(PURGE_LIMIT);
      if (error || typeof data !== 'number') {
        deps.log('ERROR', 'Push deliveries could not be purged', {
          code: error?.code,
        });
        return 0;
      }
      return data;
    } catch {
      deps.log('ERROR', 'Push purge crashed');
      return 0;
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

    const accessToken = deps.getExpoAccessToken();
    if (!accessToken) {
      // Before claiming: a claim without a sender would burn an attempt on every row.
      deps.log('ERROR', 'EXPO_ACCESS_TOKEN is not configured');
      return json({ error: 'MISSING_SERVER_CONFIG' }, 500);
    }

    try {
      const credentialCodes = new Set<string>();
      const sendTotals = await sendPhase(credentialCodes, accessToken);
      if (!sendTotals) return json({ error: 'INTERNAL_ERROR' }, 500);
      const receipts = await receiptsPhase(credentialCodes, accessToken);
      const purged = await purgePhase();
      for (const code of credentialCodes) await reportCredentialProblem(code);

      const summary = { ...sendTotals, receipts, purged };
      deps.log('INFO', 'Push dispatch run finished', summary);
      return json(summary, 200);
    } catch {
      deps.log('ERROR', 'Push dispatch run crashed');
      return json({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}
