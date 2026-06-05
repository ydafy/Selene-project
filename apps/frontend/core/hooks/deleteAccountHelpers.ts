/**
 * Pure helpers for the delete-account flow.
 * Kept hook-free so they can be unit tested with bun:test.
 */

export const DELETE_CONFIRMATION_PHRASE = 'ELIMINAR';

export type DeleteAccountResponse =
  | { success: true }
  | { error: string; blocked_reason?: string }
  | null
  | undefined;

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; errorKey: string };

const KNOWN_BLOCKED_REASONS = [
  'active_shipments',
  'active_orders',
  'open_disputes',
  'pending_payouts',
  'available_balance',
] as const;

type KnownReason = (typeof KNOWN_BLOCKED_REASONS)[number];

const isKnownReason = (value: string | undefined): value is KnownReason =>
  !!value && (KNOWN_BLOCKED_REASONS as readonly string[]).includes(value);

/**
 * Map the raw edge-function payload to a UI-ready result with a translation key.
 */
export const mapDeleteAccountResponse = (
  data: DeleteAccountResponse,
): DeleteAccountResult => {
  if (!data) {
    return { ok: false, errorKey: 'settings:errors.deleteFailed' };
  }
  if ('success' in data && data.success === true) {
    return { ok: true };
  }
  // Auth failures — session expired or invalid token.
  if ('error' in data && (data.error === 'UNAUTHORIZED' || data.error === 'AUTH_REQUIRED')) {
    return { ok: false, errorKey: 'settings:errors.authRequired' };
  }
  if ('blocked_reason' in data && isKnownReason(data.blocked_reason)) {
    return {
      ok: false,
      errorKey: `settings:blockedReasons.${data.blocked_reason}`,
    };
  }
  return { ok: false, errorKey: 'settings:errors.deleteFailed' };
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
