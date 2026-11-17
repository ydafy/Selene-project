import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

// The screens are not mounted in tests, so pin that each one uses the rule above.
describe('screens wire the flow', () => {
  const FRONTEND = join(import.meta.dir, '..', '..', '..', '..');
  const flat = (path: string) =>
    readFileSync(join(FRONTEND, path), 'utf8').replace(/\s+/g, ' ');

  it('the success screen picks its text from the payment need (S1)', () => {
    expect(flat('src/app/sell/success.tsx')).toContain(
      '{t(resolveSellSuccessSubtitleKey(paymentNeed))}',
    );
  });

  it('the guide shows "later" only from the publish flow and keeps it a way out (S3, S5)', () => {
    const guide = flat('src/app/sell/onboarding.tsx');
    expect(guide).toContain(
      'const exit = resolveFirstListingOnboardingExit(params);',
    );
    expect(guide).toContain(
      '{exit.showLater && ( <TouchableOpacity onPress={() => router.replace(exit.successRoute)}',
    );
  });

  it('my listings reads the payment status once and passes it to every card (S4)', () => {
    const listings = flat('src/app/profile/listings.tsx');
    expect(listings.match(/usePaymentSetupNeed\(/g)).toHaveLength(1);
    expect(listings).toContain('paymentNeed={paymentNeed}');
    expect(
      flat('src/features/profile/components/my-listing-card.tsx'),
    ).toContain('resolveListingStatusKey(product, paymentNeed)');
  });

  it('only a payments chip opens the guide; every other chip stays inert (S4)', () => {
    const card = flat('src/features/profile/components/my-listing-card.tsx');
    expect(card).toContain(
      "disabled={!opensPayments} onPress={ opensPayments ? () => router.push('/sell/onboarding') : undefined }",
    );
  });

  it('success, verify and listings read the need through the same hook (S5)', () => {
    for (const screen of [
      'src/app/sell/success.tsx',
      'src/app/verify/[id].tsx',
      'src/app/profile/listings.tsx',
    ]) {
      expect(flat(screen)).toContain(
        'const paymentNeed = usePaymentSetupNeed();',
      );
    }
  });
});
