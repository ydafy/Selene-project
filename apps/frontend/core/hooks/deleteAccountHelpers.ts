/**
 * Pure helpers for the delete-account flow.
 * Kept hook-free so they can be unit tested with bun:test.
 */

export const DELETE_CONFIRMATION_PHRASE = 'ELIMINAR';

/** What the `delete-account` Edge Function answered: HTTP status plus JSON body. */
export type DeleteAccountHttpResponse = {
  /** `null` when no HTTP response arrived (network failure). */
  status: number | null;
  body: unknown;
};

export type DeleteAccountResult =
  | { ok: true }
  | {
      ok: false;
      errorKey: string;
      /** The function wants a recent sign-in before it deletes anything. */
      reauthRequired?: boolean;
      /** The user cancelled a native sign-in; show nothing. */
      silent?: boolean;
      /** The form field the error belongs under. */
      field?: 'password';
    };

const KNOWN_BLOCKED_REASONS = [
  'account_restricted',
  'active_shipments',
  'active_orders',
  'open_disputes',
  'pending_payouts',
  'pending_refunds',
] as const;

type KnownReason = (typeof KNOWN_BLOCKED_REASONS)[number];

const isKnownReason = (value: unknown): value is KnownReason =>
  typeof value === 'string' &&
  (KNOWN_BLOCKED_REASONS as readonly string[]).includes(value);

const DELETE_FAILED = { ok: false, errorKey: 'settings:errors.deleteFailed' } as const;
const RETRY_LATER = { ok: false, errorKey: 'settings:errors.retryLater' } as const;

/**
 * `supabase.functions.invoke` reports every non-2xx as an error whose
 * `context` is the raw `Response`. Recover status and JSON body from it;
 * anything without a response is a network failure.
 */
export const readInvokeFailure = async (
  error: unknown,
): Promise<DeleteAccountHttpResponse> => {
  const context =
    typeof error === 'object' && error !== null
      ? (error as { context?: unknown }).context
      : undefined;
  if (
    typeof context !== 'object' ||
    context === null ||
    typeof (context as { status?: unknown }).status !== 'number'
  ) {
    return { status: null, body: null };
  }
  const response = context as { status: number; json?: () => Promise<unknown> };
  const body = await response.json?.().catch(() => null);
  return { status: response.status, body: body ?? null };
};

/**
 * Map the Edge Function answer to a UI-ready result with a translation key.
 * Contract: `supabase/functions/delete-account/handler.ts`.
 */
export const mapDeleteAccountResponse = ({
  status,
  body,
}: DeleteAccountHttpResponse): DeleteAccountResult => {
  const payload =
    typeof body === 'object' && body !== null
      ? (body as { success?: unknown; error?: unknown; blocked_reason?: unknown })
      : {};

  if (status === 200) {
    return payload.success === true ? { ok: true } : DELETE_FAILED;
  }
  if (status === 401) {
    return { ok: false, errorKey: 'settings:errors.authRequired' };
  }
  if (status === 403) {
    return payload.error === 'REAUTH_REQUIRED'
      ? {
          ok: false,
          errorKey: 'settings:errors.reauthFailed',
          reauthRequired: true,
        }
      : DELETE_FAILED;
  }
  if (status === 409) {
    return payload.error === 'DELETE_BLOCKED' &&
      isKnownReason(payload.blocked_reason)
      ? {
          ok: false,
          errorKey: `settings:blockedReasons.${payload.blocked_reason}`,
        }
      : DELETE_FAILED;
  }
  if (status === null || status === 404 || status === 429 || status >= 500) {
    return RETRY_LATER;
  }
  return DELETE_FAILED;
};

/**
 * Validate that the user typed the destructive confirmation phrase exactly
 * (whitespace allowed at the edges, case-sensitive).
 */
export const validateDeleteConfirmation = (input: string): boolean =>
  input.trim() === DELETE_CONFIRMATION_PHRASE;

/**
 * Strip the settings namespace prefix from a translation key.
 * e.g. "settings:errors.deleteFailed" → "errors.deleteFailed"
 * Used across components to normalize error keys for useTranslation('settings').
 */
export const stripSettingsNamespace = (key: string): string =>
  key.startsWith('settings:') ? key.slice(9) : key;
