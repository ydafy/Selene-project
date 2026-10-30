/**
 * @file supabase/functions/dispatch-push/expo.ts
 *
 * Client for the two Expo Push API calls dispatch-push needs. It takes `fetch` and the access
 * token as arguments, so the handler stays testable. A failed request returns a short machine
 * code and never the provider's message text.
 */

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const REQUEST_TIMEOUT_MS = 15_000;
const SAFE_CODE = /^[A-Za-z0-9_]{1,64}$/;

export type ExpoMessage = {
  to: string;
  title: string;
  body?: string;
  data: {
    notification_id: string;
    action_path: string | null;
    event_kind: string;
  };
  channelId: string;
  sound: 'default';
  priority: 'high';
  ttl: number;
};

export type ExpoTicket = { ok: true; id: string } | { ok: false; code: string };
export type ExpoReceipt = { ok: true } | { ok: false; code: string };

/** A whole-request failure carries one machine code; nothing from the response text. */
export type ExpoResult<T> = { ok: true; data: T } | { ok: false; code: string };

type Fetch = typeof fetch;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const safeCode = (value: unknown, fallback: string): string =>
  typeof value === 'string' && SAFE_CODE.test(value) ? value : fallback;

/** The Expo error code of a ticket or receipt (`details.error`), or 'error'. */
const detailCode = (entry: Record<string, unknown>): string =>
  safeCode(asRecord(entry.details)?.error, 'error');

async function post(
  fetchImpl: Fetch,
  url: string,
  accessToken: string,
  payload: unknown,
): Promise<ExpoResult<unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const name = asRecord(error)?.name;
    return {
      ok: false,
      code:
        name === 'TimeoutError' || name === 'AbortError'
          ? 'expo_timeout'
          : 'expo_network',
    };
  }
  if (!response.ok) return { ok: false, code: `expo_http_${response.status}` };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: 'expo_bad_response' };
  }
  const record = asRecord(body);
  if (!record) return { ok: false, code: 'expo_bad_response' };
  if (record.errors !== undefined) {
    const first = Array.isArray(record.errors)
      ? asRecord(record.errors[0])
      : null;
    return { ok: false, code: safeCode(first?.code, 'expo_error') };
  }
  if (record.data === undefined || record.data === null)
    return { ok: false, code: 'expo_bad_response' };
  return { ok: true, data: record.data };
}

/** Sends up to 100 messages; tickets come back in request order. */
export async function sendPushMessages(
  fetchImpl: Fetch,
  accessToken: string,
  messages: ExpoMessage[],
): Promise<ExpoResult<ExpoTicket[]>> {
  const result = await post(fetchImpl, SEND_URL, accessToken, messages);
  if (!result.ok) return result;
  if (!Array.isArray(result.data) || result.data.length !== messages.length) {
    return { ok: false, code: 'expo_ticket_mismatch' };
  }
  return {
    ok: true,
    data: result.data.map((entry): ExpoTicket => {
      const ticket = asRecord(entry);
      if (
        ticket?.status === 'ok' &&
        typeof ticket.id === 'string' &&
        ticket.id !== ''
      ) {
        return { ok: true, id: ticket.id };
      }
      return {
        ok: false,
        code:
          ticket?.status === 'error'
            ? detailCode(ticket)
            : 'expo_ticket_invalid',
      };
    }),
  };
}

/**
 * Fetches receipts for up to 1000 ticket ids. A ticket missing from the map has no receipt yet;
 * an entry with an unknown status is left out as well.
 */
export async function getPushReceipts(
  fetchImpl: Fetch,
  accessToken: string,
  ids: string[],
): Promise<ExpoResult<Map<string, ExpoReceipt>>> {
  const result = await post(fetchImpl, RECEIPTS_URL, accessToken, { ids });
  if (!result.ok) return result;
  const data = asRecord(result.data);
  if (!data) return { ok: false, code: 'expo_bad_response' };
  const receipts = new Map<string, ExpoReceipt>();
  for (const [id, value] of Object.entries(data)) {
    const receipt = asRecord(value);
    if (receipt?.status === 'ok') receipts.set(id, { ok: true });
    else if (receipt?.status === 'error')
      receipts.set(id, { ok: false, code: detailCode(receipt) });
  }
  return { ok: true, data: receipts };
}
