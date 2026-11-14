import { describe, expect, it } from 'bun:test';

import {
  daysHeldLabel,
  sellerPayoutBlockReasonLabel,
} from './seller-payout-block-reason';

describe('sellerPayoutBlockReasonLabel', () => {
  it.each([
    ['onboarding_rejected', 'Stripe rechazó el registro del vendedor'],
    ['onboarding_pending', 'Registro de Stripe incompleto'],
    ['payouts_disabled', 'Stripe deshabilitó los pagos'],
    ['payouts_schedule_not_manual', 'Pagos de la cuenta no están en manual'],
    ['errored', 'Cuenta bancaria con error'],
    ['verification_failed', 'Cuenta bancaria con error'],
    ['tokenized_account_number_deactivated', 'Cuenta bancaria con error'],
    ['destination_undetermined', 'Cuenta bancaria sin confirmar'],
    ['account_refresh_pending', 'Verificando la cuenta con Stripe'],
    [
      'account_not_actionable',
      'La cuenta no puede cobrar (account_not_actionable)',
    ],
  ])('explains %s in plain Spanish', (code, expected) => {
    expect(sellerPayoutBlockReasonLabel(code)).toBe(expected);
  });

  it('keeps an unknown gate code visible instead of hiding it', () => {
    expect(sellerPayoutBlockReasonLabel('brand_new_gate')).toBe(
      'La cuenta no puede cobrar (brand_new_gate)',
    );
  });
});

describe('daysHeldLabel', () => {
  it.each([
    [0, 'Completado hoy'],
    [1, 'Retenido hace 1 día'],
    [2, 'Retenido hace 2 días'],
    [14, 'Retenido hace 14 días'],
  ])('labels %i days held', (days, expected) => {
    expect(daysHeldLabel(days)).toBe(expected);
  });

  it('treats a completion stamped slightly in the future as today', () => {
    expect(daysHeldLabel(-1)).toBe('Completado hoy');
  });
});
