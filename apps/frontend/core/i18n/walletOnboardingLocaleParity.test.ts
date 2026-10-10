import { describe, expect, it } from 'bun:test';

import enWallet from './locales/en/wallet.json';
import esWallet from './locales/es/wallet.json';

const REQUIRED_STATUS_GUIDANCE_KEYS = [
  'newTitle',
  'newDesc',
  'pendingTitle',
  'pendingDesc',
  'rejectedTitle',
  'rejectedDesc',
] as const;

describe('wallet onboarding locale parity', () => {
  it('keeps shared payment copy and interpolation tokens aligned without guaranteed dates', () => {
    const en = enWallet.onboarding as unknown as Record<string, Record<string, string>>;
    const es = esWallet.onboarding as unknown as Record<string, Record<string, string>>;
    expect(en.paymentExplanation).toBeDefined();
    expect(es.paymentExplanation).toBeDefined();
    expect(Object.keys(en.paymentExplanation).sort()).toEqual(Object.keys(es.paymentExplanation).sort());
    for (const key of ['title', 'buyerReview', 'release', 'bank', 'delays']) {
      expect(en.paymentExplanation[key]).toBeString();
      expect(es.paymentExplanation[key]).toBeString();
      expect(en.paymentExplanation[key].match(/{{[^}]+}}/g) ?? []).toEqual(es.paymentExplanation[key].match(/{{[^}]+}}/g) ?? []);
    }
    expect(en.paymentExplanation.buyerReview).toContain('48 hours');
    expect(es.paymentExplanation.buyerReview).toContain('48 horas');
    expect(en.paymentExplanation.release).toContain('daily');
    expect(es.paymentExplanation.release).toContain('diariamente');
    expect(en.paymentExplanation.bank).toContain('1–4 business days after the deposit is initiated');
    expect(es.paymentExplanation.bank).toContain('1–4 días hábiles después de que se inicia el depósito');
    for (const copy of [en.paymentExplanation, es.paymentExplanation]) {
      expect(copy.delays).toContain('Stripe');
      expect(copy.delays).not.toMatch(/\d/);
      expect(Object.values(copy).join(' ')).not.toMatch(/same.day|guaranteed|garantizado/i);
    }
    expect(en.success.subtitle).not.toContain('deposit schedule');
    expect(es.success.subtitle).not.toContain('calendario de depósitos');
  });
  it('keeps final-step status guidance keys in English and Spanish', () => {
    for (const key of REQUIRED_STATUS_GUIDANCE_KEYS) {
      expect(enWallet.onboarding.statusGuidance[key]).toBeString();
      expect(esWallet.onboarding.statusGuidance[key]).toBeString();
    }

    expect(Object.keys(enWallet.onboarding.statusGuidance).sort()).toEqual(
      Object.keys(esWallet.onboarding.statusGuidance).sort(),
    );
  });
});
