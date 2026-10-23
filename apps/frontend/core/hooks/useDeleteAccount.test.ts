import { expect, test, describe } from 'bun:test';
import {
  mapDeleteAccountResponse,
  readInvokeFailure,
  validateDeleteConfirmation,
  stripSettingsNamespace,
  DELETE_CONFIRMATION_PHRASE,
} from './deleteAccountHelpers';

const FAILED = 'settings:errors.deleteFailed';
const RETRY = 'settings:errors.retryLater';

describe('mapDeleteAccountResponse', () => {
  test('200 with success flag is ok', () => {
    expect(
      mapDeleteAccountResponse({ status: 200, body: { success: true } }),
    ).toEqual({ ok: true });
  });

  test('200 without the success flag is a failure', () => {
    expect(mapDeleteAccountResponse({ status: 200, body: {} })).toEqual({
      ok: false,
      errorKey: FAILED,
    });
  });

  for (const reason of [
    'account_restricted',
    'active_shipments',
    'active_orders',
    'open_disputes',
    'pending_payouts',
    'pending_refunds',
  ]) {
    test(`409 DELETE_BLOCKED ${reason} maps to its blocked message`, () => {
      expect(
        mapDeleteAccountResponse({
          status: 409,
          body: { error: 'DELETE_BLOCKED', blocked_reason: reason },
        }),
      ).toEqual({ ok: false, errorKey: `settings:blockedReasons.${reason}` });
    });
  }

  test('the obsolete available_balance reason is no longer known', () => {
    expect(
      mapDeleteAccountResponse({
        status: 409,
        body: { error: 'DELETE_BLOCKED', blocked_reason: 'available_balance' },
      }),
    ).toEqual({ ok: false, errorKey: FAILED });
  });

  test('409 with an unknown reason falls back to deleteFailed', () => {
    expect(
      mapDeleteAccountResponse({
        status: 409,
        body: { error: 'DELETE_BLOCKED', blocked_reason: 'weird_reason' },
      }),
    ).toEqual({ ok: false, errorKey: FAILED });
  });

  test('403 REAUTH_REQUIRED asks for reauthentication', () => {
    expect(
      mapDeleteAccountResponse({
        status: 403,
        body: { error: 'REAUTH_REQUIRED' },
      }),
    ).toEqual({
      ok: false,
      errorKey: 'settings:errors.reauthFailed',
      reauthRequired: true,
    });
  });

  test('403 with another code is a plain failure', () => {
    expect(
      mapDeleteAccountResponse({ status: 403, body: { error: 'FORBIDDEN' } }),
    ).toEqual({ ok: false, errorKey: FAILED });
  });

  test('401 AUTH_REQUIRED maps to the session expired message', () => {
    expect(
      mapDeleteAccountResponse({
        status: 401,
        body: { error: 'AUTH_REQUIRED' },
      }),
    ).toEqual({ ok: false, errorKey: 'settings:errors.authRequired' });
  });

  test('401 without a parseable body still maps to session expired', () => {
    expect(mapDeleteAccountResponse({ status: 401, body: null })).toEqual({
      ok: false,
      errorKey: 'settings:errors.authRequired',
    });
  });

  for (const status of [503, 500, 404, 502, 429]) {
    test(`${status} maps to the retry-later message`, () => {
      expect(
        mapDeleteAccountResponse({ status, body: { error: 'X' } }),
      ).toEqual({ ok: false, errorKey: RETRY });
    });
  }

  test('a network failure (no status) maps to the retry-later message', () => {
    expect(mapDeleteAccountResponse({ status: null, body: null })).toEqual({
      ok: false,
      errorKey: RETRY,
    });
  });

  test('a non-object body never throws', () => {
    expect(mapDeleteAccountResponse({ status: 409, body: 'oops' })).toEqual({
      ok: false,
      errorKey: FAILED,
    });
  });
});

describe('readInvokeFailure', () => {
  test('reads status and JSON body from the HTTP error context', async () => {
    const context = new Response(JSON.stringify({ error: 'REAUTH_REQUIRED' }), {
      status: 403,
    });
    expect(await readInvokeFailure({ context })).toEqual({
      status: 403,
      body: { error: 'REAUTH_REQUIRED' },
    });
  });

  test('keeps the status when the body is not JSON', async () => {
    const context = new Response('<html>', { status: 503 });
    expect(await readInvokeFailure({ context })).toEqual({
      status: 503,
      body: null,
    });
  });

  test('an error without an HTTP context is a network failure', async () => {
    expect(await readInvokeFailure(new Error('Failed to fetch'))).toEqual({
      status: null,
      body: null,
    });
    expect(await readInvokeFailure(null)).toEqual({ status: null, body: null });
  });
});

describe('validateDeleteConfirmation', () => {
  test('accepts the exact phrase', () => {
    expect(validateDeleteConfirmation(DELETE_CONFIRMATION_PHRASE)).toBe(true);
  });

  test('accepts trimmed phrase', () => {
    expect(validateDeleteConfirmation('  ELIMINAR  ')).toBe(true);
  });

  test('rejects empty string', () => {
    expect(validateDeleteConfirmation('')).toBe(false);
  });

  test('rejects different case', () => {
    expect(validateDeleteConfirmation('eliminar')).toBe(false);
  });

  test('rejects different phrase', () => {
    expect(validateDeleteConfirmation('BORRAR')).toBe(false);
  });
});

describe('stripSettingsNamespace', () => {
  test('strips settings: prefix', () => {
    expect(stripSettingsNamespace('settings:errors.deleteFailed')).toBe('errors.deleteFailed');
  });

  test('passes through non-namespaced keys', () => {
    expect(stripSettingsNamespace('errors.deleteFailed')).toBe('errors.deleteFailed');
  });

  test('handles exact "settings:" prefix only', () => {
    expect(stripSettingsNamespace('settings_blocked')).toBe('settings_blocked');
  });
});
