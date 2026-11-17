import { describe, expect, it } from 'bun:test';

import enSellerOnboarding from './locales/en/sellerOnboarding.json';
import esSellerOnboarding from './locales/es/sellerOnboarding.json';
import enOrders from './locales/en/orders.json';
import esOrders from './locales/es/orders.json';

const REQUIRED_STATUS_NOTICE_KEYS = [
  'pendingTitle',
  'pendingDesc',
  'rejectedTitle',
  'rejectedDesc',
  'expiredTitle',
  'expiredDesc',
] as const;

const GUIDE_CARD_KEYS = ['phone', 'ine', 'clabe'] as const;

const BOLD_WORD = {
  en: { phone: 'SMS code', ine: 'INE', clabe: 'CLABE' },
  es: { phone: 'código por SMS', ine: 'INE', clabe: 'CLABE' },
} as const;

describe('seller onboarding locale parity', () => {
  it('keeps shared payment copy and interpolation tokens aligned without guaranteed dates', () => {
    const en = enSellerOnboarding as unknown as Record<
      string,
      Record<string, string>
    >;
    const es = esSellerOnboarding as unknown as Record<
      string,
      Record<string, string>
    >;
    expect(en.paymentExplanation).toBeDefined();
    expect(es.paymentExplanation).toBeDefined();
    expect(Object.keys(en.paymentExplanation).sort()).toEqual(
      Object.keys(es.paymentExplanation).sort(),
    );
    for (const key of ['title', 'buyerReview', 'release', 'bank', 'delays']) {
      expect(en.paymentExplanation[key]).toBeString();
      expect(es.paymentExplanation[key]).toBeString();
      expect(en.paymentExplanation[key].match(/{{[^}]+}}/g) ?? []).toEqual(
        es.paymentExplanation[key].match(/{{[^}]+}}/g) ?? [],
      );
    }
    expect(en.paymentExplanation.buyerReview).toContain('48 hours');
    expect(es.paymentExplanation.buyerReview).toContain('48 horas');
    expect(en.paymentExplanation.release).toContain('daily');
    expect(es.paymentExplanation.release).toContain('diariamente');
    expect(en.paymentExplanation.bank).toContain(
      '1–4 business days after the deposit is initiated',
    );
    expect(es.paymentExplanation.bank).toContain(
      '1–4 días hábiles después de que se inicia el depósito',
    );
    for (const copy of [en.paymentExplanation, es.paymentExplanation]) {
      expect(copy.delays).toContain('Stripe');
      expect(copy.delays).not.toMatch(/\d/);
      expect(Object.values(copy).join(' ')).not.toMatch(
        /same.day|guaranteed|garantizado/i,
      );
    }
    expect(en.success.subtitle).not.toContain('deposit schedule');
    expect(es.success.subtitle).not.toContain('calendario de depósitos');
  });
  it('keeps the status notice keys, including the expired link, in English and Spanish', () => {
    for (const key of REQUIRED_STATUS_NOTICE_KEYS) {
      expect(enSellerOnboarding.statusNotice[key]).toBeString();
      expect(esSellerOnboarding.statusNotice[key]).toBeString();
    }

    expect(Object.keys(enSellerOnboarding.statusNotice).sort()).toEqual(
      Object.keys(esSellerOnboarding.statusNotice).sort(),
    );
  });

  it('gives each guide card one line with its key word in bold', () => {
    for (const [locale, copy] of [
      ['en', enSellerOnboarding],
      ['es', esSellerOnboarding],
    ] as const) {
      for (const card of GUIDE_CARD_KEYS) {
        const guidance = copy.guidance as Record<string, string>;
        expect(guidance[`${card}Title`]).toBeString();
        const description = guidance[`${card}Desc`];
        expect(description.match(/<resaltar>(.*?)<\/resaltar>/g)).toEqual([
          `<resaltar>${BOLD_WORD[locale][card]}</resaltar>`,
        ]);
        expect(description.trim().split(/[.!?]\s+/)).toHaveLength(1);
      }
    }
  });

  it('explains Stripe behind a help dialog in English and Spanish', () => {
    for (const copy of [enSellerOnboarding, esSellerOnboarding]) {
      const help = (copy as Record<string, Record<string, string>>)
        .whatIsStripe;
      for (const key of ['label', 'title', 'desc', 'confirm']) {
        expect(help?.[key]).toBeString();
      }
      expect(help.desc).toContain('Stripe');
    }
  });

  it('uses one time estimate in the guide and the prepare-shipment notice', () => {
    expect(esSellerOnboarding.header.subtitle).toContain('unos 5 minutos');
    expect(esOrders.prepare.connectBody).toContain('unos 5 minutos');
    expect(enSellerOnboarding.header.subtitle).toContain('about 5 minutes');
    expect(enOrders.prepare.connectBody).toContain('about 5 minutes');
  });
});
