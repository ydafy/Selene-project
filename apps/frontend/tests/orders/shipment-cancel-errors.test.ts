import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCancelOrderFailureToast } from '../../core/utils/shipment-cancel-safety';

const FRONTEND = join(import.meta.dir, '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8');
const locale = (lang: string) =>
  JSON.parse(read(`core/i18n/locales/${lang}/orders.json`)) as Record<
    string,
    unknown
  >;

const lookup = (json: Record<string, unknown>, key: string): unknown =>
  key
    .replace(/^orders:/, '')
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      json,
    );

// Every error the cancel-order Edge Function can answer, grouped by what the
// user can do about it.
const GROUPS: Record<string, string[]> = {
  maintenance: ['MAINTENANCE_MODE'],
  session: ['AUTH_REQUIRED', 'No autorizado'],
  notAllowed: [
    'UNAUTHORIZED',
    'BUYER_ONLY',
    'ORDER_BUYER_MISMATCH',
    'SHIPMENT_SELLER_MISMATCH',
    'SHIPMENT_ORDER_MISMATCH',
    'ORDER_NOT_FOUND',
  ],
  notCancelable: ['SHIPMENT_NOT_CANCELABLE'],
  busy: [
    'CANCELLATION_BUSY',
    'CANCELLATION_CLAIM_FAILED',
    'CANCELLATION_START_FAILED',
  ],
  inProgress: [
    'CANCELLATION_REFUND_UNCONFIRMED',
    'CANCELLATION_REFUND_PROVIDER_FAILED',
    'CANCELLATION_REFUND_RECORD_FAILED',
    'CANCELLATION_REFUND_RECORD_INVALID',
    'CANCELLATION_REFUND_LOOKUP_FAILED',
    'CANCELLATION_RECOVERY_UNAVAILABLE',
    'CANCELLATION_ESCALATION_FAILED',
    'Dinero devuelto, pero error al actualizar inventario. Soporte técnico ha sido notificado.',
  ],
  review: ['CANCELLATION_RECOVERY_REQUIRED', 'CANCELLATION_CARRIER_PENDING'],
  needsSupport: ['STRIPE_TRANSFER_ALREADY_RELEASED', 'REFUND_AMOUNT_EXCEEDS_CAP'],
  generic: [
    'SYSTEM_SETTINGS_NOT_FOUND',
    'MISSING_STRIPE_SECRET_KEY',
    'PAYMENT_INTENT_NOT_FOUND',
    'STRIPE_CHARGE_NOT_FOUND',
    'ORDER_ITEMS_NOT_FOUND',
    'INVALID_CANCEL_REQUEST',
    'ORDER_ID_REQUIRED',
    'SHIPMENT_ID_REQUIRED',
    'CANCELLATION_RESERVATION_INVALID',
    'Failed to send a request to the Edge Function',
  ],
};

describe('resolveCancelOrderFailureToast', () => {
  for (const [group, codes] of Object.entries(GROUPS)) {
    for (const code of codes) {
      it(`maps ${code} to ${group}`, () => {
        expect(resolveCancelOrderFailureToast(new Error(code))).toEqual({
          titleKey: `orders:cancelErrors.${group}.title`,
          messageKey: `orders:cancelErrors.${group}.message`,
        });
      });
    }
  }

  it('maps a string error and a non-error value', () => {
    expect(resolveCancelOrderFailureToast('CANCELLATION_BUSY').messageKey).toBe(
      'orders:cancelErrors.busy.message',
    );
    expect(resolveCancelOrderFailureToast({}).messageKey).toBe(
      'orders:cancelErrors.generic.message',
    );
  });

  it('has an English and a Spanish text for every key it returns', () => {
    const en = locale('en');
    const es = locale('es');
    for (const group of Object.keys(GROUPS)) {
      for (const part of ['title', 'message']) {
        const key = `orders:cancelErrors.${group}.${part}`;
        expect(typeof lookup(en, key)).toBe('string');
        expect(typeof lookup(es, key)).toBe('string');
      }
    }
    expect(Object.keys(lookup(en, 'cancelErrors') as object).sort()).toEqual(
      Object.keys(GROUPS).sort(),
    );
    expect(Object.keys(lookup(es, 'cancelErrors') as object).sort()).toEqual(
      Object.keys(GROUPS).sort(),
    );
  });

  it('never tells the user to retry blindly when a refund may already exist', () => {
    const es = locale('es');
    const en = locale('en');
    expect(lookup(es, 'cancelErrors.inProgress.message')).toContain(
      'no se duplica',
    );
    expect(lookup(en, 'cancelErrors.inProgress.message')).toContain(
      'will not be duplicated',
    );
  });

  it('translates the toast through i18n instead of a missing key or fixed Spanish', () => {
    const hook = read('core/hooks/useOrderActions.ts');
    const utility = read('core/utils/shipment-cancel-safety.ts');
    expect(hook).toContain('text1: t(toast.titleKey)');
    expect(hook).toContain('text2: t(toast.messageKey)');
    expect(hook).not.toContain("t('errors.errorTitle', toast.title)");
    expect(utility).not.toContain('No pudimos cancelar');
  });
});
