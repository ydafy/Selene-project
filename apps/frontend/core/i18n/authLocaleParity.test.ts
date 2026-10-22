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
});
