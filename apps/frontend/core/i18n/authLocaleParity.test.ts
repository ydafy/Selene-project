import { describe, expect, it } from 'bun:test';

import enAuth from './locales/en/auth.json';
import esAuth from './locales/es/auth.json';

const REQUIRED_KEYS = [
  'verificationRequired',
  'resendingCode',
  'resendCodeSuccessTitle',
  'resendCodeSuccessMsg',
  'accountAlreadyExistsTitle',
  'accountAlreadyExistsMsg',
] as const;

const ERROR_KEYS = [
  'invalidCredentials',
  'emailNotConfirmed',
  'weakPassword',
  'rateLimited',
  'otpExpired',
  'validationFailed',
  'signupDisabled',
  'network',
  'googleSignInFailed',
  'missingEmail',
] as const;

describe('auth locale parity', () => {
  it('defines the verification and existing-account keys in both languages', () => {
    const en = enAuth as unknown as Record<string, string>;
    const es = esAuth as unknown as Record<string, string>;
    for (const key of REQUIRED_KEYS) {
      expect(en[key]).toBeString();
      expect(en[key].length).toBeGreaterThan(0);
      expect(es[key]).toBeString();
      expect(es[key].length).toBeGreaterThan(0);
    }
  });

  it('defines the modal copy used by AuthModal in both languages', () => {
    for (const modal of [enAuth.modal, esAuth.modal] as Record<string, string>[]) {
      expect(modal.welcomeBack).toBeString();
      expect(modal.createAccount).toBeString();
    }
  });

  it('defines the localized auth error messages in both languages', () => {
    for (const errors of [enAuth.errors, esAuth.errors] as Record<
      string,
      string
    >[]) {
      for (const key of ERROR_KEYS) {
        expect(errors[key]).toBeString();
        expect(errors[key].length).toBeGreaterThan(0);
      }
    }
  });

  it('defines the resend countdown with a seconds placeholder in both languages', () => {
    for (const auth of [enAuth, esAuth] as unknown as Record<
      string,
      string
    >[]) {
      expect(auth.resendCodeIn).toContain('{{seconds}}');
    }
  });
});
