import { expect, test, describe } from 'bun:test';
import {
  mapDeleteAccountResponse,
  validateDeleteConfirmation,
  stripSettingsNamespace,
  DELETE_CONFIRMATION_PHRASE,
} from './deleteAccountHelpers';

describe('mapDeleteAccountResponse', () => {
  test('returns ok=true when success flag is true', () => {
    expect(mapDeleteAccountResponse({ success: true })).toEqual({
      ok: true,
    });
  });

  test('maps active_orders blocked_reason to i18n key', () => {
    expect(
      mapDeleteAccountResponse({
        error: 'DELETE_BLOCKED',
        blocked_reason: 'active_orders',
      }),
    ).toEqual({
      ok: false,
      errorKey: 'settings:blockedReasons.active_orders',
    });
  });

  test('maps active_shipments blocked_reason to i18n key', () => {
    expect(
      mapDeleteAccountResponse({
        error: 'DELETE_BLOCKED',
        blocked_reason: 'active_shipments',
      }),
    ).toEqual({
      ok: false,
      errorKey: 'settings:blockedReasons.active_shipments',
    });
  });

  test('maps open_disputes blocked_reason', () => {
    expect(
      mapDeleteAccountResponse({
        error: 'DELETE_BLOCKED',
        blocked_reason: 'open_disputes',
      }),
    ).toEqual({
      ok: false,
      errorKey: 'settings:blockedReasons.open_disputes',
    });
  });

  test('maps pending_payouts blocked_reason', () => {
    expect(
      mapDeleteAccountResponse({
        error: 'DELETE_BLOCKED',
        blocked_reason: 'pending_payouts',
      }),
    ).toEqual({
      ok: false,
      errorKey: 'settings:blockedReasons.pending_payouts',
    });
  });

  test('maps available_balance blocked_reason', () => {
    expect(
      mapDeleteAccountResponse({
        error: 'DELETE_BLOCKED',
        blocked_reason: 'available_balance',
      }),
    ).toEqual({
      ok: false,
      errorKey: 'settings:blockedReasons.available_balance',
    });
  });

  test('unknown blocked_reason falls back to deleteFailed', () => {
    expect(
      mapDeleteAccountResponse({
        error: 'DELETE_BLOCKED',
        blocked_reason: 'weird_reason',
      }),
    ).toEqual({
      ok: false,
      errorKey: 'settings:errors.deleteFailed',
    });
  });

  test('null/undefined data falls back to deleteFailed', () => {
    expect(mapDeleteAccountResponse(null)).toEqual({
      ok: false,
      errorKey: 'settings:errors.deleteFailed',
    });
    expect(mapDeleteAccountResponse(undefined)).toEqual({
      ok: false,
      errorKey: 'settings:errors.deleteFailed',
    });
  });

  test('plain error without blocked_reason falls back to deleteFailed', () => {
    expect(mapDeleteAccountResponse({ error: 'INTERNAL' })).toEqual({
      ok: false,
      errorKey: 'settings:errors.deleteFailed',
    });
  });

  test('UNAUTHORIZED error maps to authRequired', () => {
    expect(mapDeleteAccountResponse({ error: 'UNAUTHORIZED' })).toEqual({
      ok: false,
      errorKey: 'settings:errors.authRequired',
    });
  });

  test('AUTH_REQUIRED error maps to authRequired', () => {
    expect(mapDeleteAccountResponse({ error: 'AUTH_REQUIRED' })).toEqual({
      ok: false,
      errorKey: 'settings:errors.authRequired',
    });
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
