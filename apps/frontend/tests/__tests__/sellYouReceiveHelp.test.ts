import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCommissionPercent } from '../../core/utils/sellerProceedsEstimate';

const FRONTEND = join(import.meta.dir, '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8');
const es = JSON.parse(read('core/i18n/locales/es/sell.json'));
const en = JSON.parse(read('core/i18n/locales/en/sell.json'));
const form = read('components/features/sell/SellDetailsForm.tsx').replace(/\s+/g, ' ');
const hook = read('core/hooks/useSellDetailsForm.ts').replace(/\s+/g, ' ');

describe('resolveCommissionPercent', () => {
  it('turns the configured fraction into a whole percent', () => {
    expect(resolveCommissionPercent(0.06)).toBe(6);
    expect(resolveCommissionPercent(0.055)).toBe(5.5);
  });

  it('returns null when the rate is missing or invalid', () => {
    expect(resolveCommissionPercent(null)).toBeNull();
    expect(resolveCommissionPercent(undefined)).toBeNull();
    expect(resolveCommissionPercent(Number.NaN)).toBeNull();
    expect(resolveCommissionPercent(-0.1)).toBeNull();
  });
});

const ES_DESC =
  'Este monto ya incluye los costos de tu venta:\n\n' +
  '• Envío: te damos la guía lista para llevar tu paquete a la paquetería.\n\n' +
  '• Seguro: si el paquete se pierde o llega dañado, abre un reporte y lo revisamos.\n\n' +
  '• Comisión del {{commissionPct}}%: solo se cobra cuando vendes y protege tu pago.\n\n' +
  'El costo final del envío puede variar un poco.';
const EN_DESC =
  'This amount already includes the costs of your sale:\n\n' +
  '• Shipping: we give you a ready label to drop your package off at the carrier.\n\n' +
  '• Insurance: if the package is lost or arrives damaged, open a report and we review it.\n\n' +
  '• {{commissionPct}}% commission: charged only when you sell, and it protects your payment.\n\n' +
  'The final shipping cost may vary slightly.';

describe('sell "you receive" help copy', () => {
  it('explains the amount briefly in words in Spanish', () => {
    expect(es.fields.youReceiveHelpTitle).toBe('¿Cómo se calcula lo que recibes?');
    expect(es.fields.youReceiveHelpDescription).toBe(ES_DESC);
    expect(es.fields.youReceiveHelpDescriptionNoRate).toBe(
      ES_DESC.replace('Comisión del {{commissionPct}}%', 'Comisión'),
    );
  });

  it('explains the amount briefly in words in English', () => {
    expect(en.fields.youReceiveHelpTitle).toBe('How is what you receive calculated?');
    expect(en.fields.youReceiveHelpDescription).toBe(EN_DESC);
    expect(en.fields.youReceiveHelpDescriptionNoRate).toBe(
      EN_DESC.replace('{{commissionPct}}% commission', 'Commission'),
    );
  });

  it('states that shipping insurance offers a refund', () => {
    expect(es.fields.shippingInsuranceDescription).toBe(
      'Si el paquete se pierde o llega dañado, se ofrece reembolso.',
    );
    expect(en.fields.shippingInsuranceDescription).toBe(
      'If the package is lost or arrives damaged, a refund is offered.',
    );
  });

  it('never shows deducted amounts, legal disclaimers, or automatic coverage', () => {
    for (const copy of [es.fields, en.fields]) {
      for (const key of ['youReceiveHelpDescription', 'youReceiveHelpDescriptionNoRate']) {
        expect(copy[key]).not.toMatch(/[-−]\s?\$/);
        expect(copy[key]).not.toMatch(
          /estás cubierto|you are covered|recoge|picks up|reembolso|reimburse|Términos|Terms/i,
        );
      }
    }
  });

  it('reads the commission from system settings, not a hardcoded rate', () => {
    expect(hook).toContain('resolveCommissionPercent(systemConfig?.service_fee_pct)');
    expect(form).toContain(
      "earnings.commissionPct === null ? t('fields.youReceiveHelpDescriptionNoRate') : t('fields.youReceiveHelpDescription', { commissionPct: earnings.commissionPct, })",
    );
  });
});
