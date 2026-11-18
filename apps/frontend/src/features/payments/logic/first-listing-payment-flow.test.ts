import { describe, expect, it } from 'bun:test';
import {
  FIRST_LISTING_ONBOARDING_SOURCE,
  resolveFirstListingOnboardingExit,
  resolveSellSuccessSubtitleKey,
  resolveVerifySuccessRoute,
} from './first-listing-payment-flow';
import esSell from '@/shared/i18n/locales/es/sell.json';
import enSell from '@/shared/i18n/locales/en/sell.json';
import esOnboarding from '@/shared/i18n/locales/es/sellerOnboarding.json';
import enOnboarding from '@/shared/i18n/locales/en/sellerOnboarding.json';

// odd/tasks/first-listing-payment-setup.md
describe('resolveSellSuccessSubtitleKey (S1)', () => {
  it('names both missing steps while payments are not set up', () => {
    expect(resolveSellSuccessSubtitleKey('setup')).toBe(
      'success.subtitleWithPayments',
    );
    expect(resolveSellSuccessSubtitleKey('rejected')).toBe(
      'success.subtitleWithPayments',
    );
  });

  it('keeps the current text otherwise', () => {
    expect(resolveSellSuccessSubtitleKey(null)).toBe('success.subtitle');
  });
});

describe('resolveVerifySuccessRoute (S2)', () => {
  it('continues to the payments guide while payments are not set up', () => {
    const toGuide = {
      pathname: '/sell/onboarding',
      params: { from: FIRST_LISTING_ONBOARDING_SOURCE },
    } as const;
    expect(resolveVerifySuccessRoute('setup')).toEqual(toGuide);
    expect(resolveVerifySuccessRoute('rejected')).toEqual(toGuide);
  });

  it('goes to the profile as today otherwise', () => {
    expect(resolveVerifySuccessRoute(null)).toBe('/(tabs)/profile');
  });
});

describe('copy', () => {
  it('names both steps on the success screen in both languages (S1)', () => {
    expect(esSell.success.subtitleWithPayments).toBe(
      'Para que alguien pueda comprarla faltan 2 pasos: verificar tu producto y activar tus cobros. Empecemos por el primero.',
    );
    expect(enSell.success.subtitleWithPayments).toBe(
      "Before anyone can buy it, two steps are left: verify your product and turn on payments. Let's start with the first one.",
    );
  });

  it('has the "later" exit in both languages (S3)', () => {
    expect(esOnboarding.actions.later).toBe('Más tarde');
    expect(enOnboarding.actions.later).toBe('Later');
  });
});

describe('resolveFirstListingOnboardingExit (S3)', () => {
  it('offers "later" and lands on the profile when opened from the listing flow', () => {
    expect(
      resolveFirstListingOnboardingExit({
        from: FIRST_LISTING_ONBOARDING_SOURCE,
      }),
    ).toEqual({ showLater: true, successRoute: '/(tabs)/profile' });
  });

  it('keeps the current behavior from anywhere else', () => {
    expect(resolveFirstListingOnboardingExit({})).toEqual({
      showLater: false,
      successRoute: '/sell',
    });
    expect(resolveFirstListingOnboardingExit({ from: 'other' })).toEqual({
      showLater: false,
      successRoute: '/sell',
    });
  });
});
