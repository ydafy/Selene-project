import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import enCheckout from '../../../core/i18n/locales/en/checkout.json';
import esCheckout from '../../../core/i18n/locales/es/checkout.json';

// Source assertions: the repo has no React Native render harness for this sheet (#27).
const source = readFileSync(
  join(import.meta.dir, 'PaymentMethodPickerModal.tsx'),
  'utf8',
);

const MODAL_KEYS = [
  'addCard',
  'verifyingCard',
  'connectingStripe',
  'loadFailed',
  'emptyTitle',
  'emptyMessage',
  'deleteTitle',
  'deleteDescription',
  'deleteAction',
  'deleteFailed',
  'limitReached',
] as const;

describe('PaymentMethodPickerModal', () => {
  it('derives the Google Pay environment from the Stripe publishable key', () => {
    expect(source).not.toMatch(/testEnv:\s*true/);
    expect(source).toContain("'checkout:payment.selectMethod'");
    expect(source).toMatch(
      /testEnv:\s*googlePayTestEnv\(\s*process\.env\.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,?\s*\)/,
    );
  });

  it('shows no hardcoded Spanish copy', () => {
    for (const literal of [
      'Mis Métodos de Pago',
      'Límite alcanzado',
      'No se pudo eliminar la tarjeta.',
      'No pudimos cargar tus tarjetas',
      'Sin tarjetas',
      'Agrega un método de pago',
      'Verificando tarjeta',
      'Conectando con Stripe',
      'Agregar Nueva Tarjeta',
      'Eliminar tarjeta',
      '¿Estás seguro',
      'confirmLabel="Eliminar"',
      "Alert.alert('Error'",
    ]) {
      expect(source).not.toContain(literal);
    }
  });

  it('never shows a raw error message in the add-card alert', () => {
    expect(source).not.toMatch(/:\s*e\.message,?\s*\)/);
  });

  it('uses checkout.payment keys that exist in English and Spanish', () => {
    const en = enCheckout.payment as Record<string, string>;
    const es = esCheckout.payment as Record<string, string>;
    for (const key of MODAL_KEYS) {
      expect(source).toContain(`'checkout:payment.${key}'`);
      expect(typeof en[key]).toBe('string');
      expect(typeof es[key]).toBe('string');
    }
    expect(en.deleteDescription).toContain('{{last4}}');
    expect(es.deleteDescription).toContain('{{last4}}');
  });
});
