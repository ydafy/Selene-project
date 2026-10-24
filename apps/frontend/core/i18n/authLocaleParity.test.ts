import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import enAuth from './locales/en/auth.json';
import esAuth from './locales/es/auth.json';
import enCommon from './locales/en/common.json';
import esCommon from './locales/es/common.json';

const FRONTEND_DIR = join(import.meta.dir, '..', '..');

// Screens and forms whose default namespace is `auth`.
const AUTH_SOURCES = [
  'app/(auth)/forgotPassword.tsx',
  'app/(auth)/verify-code.tsx',
  'app/(auth)/resetPassword.tsx',
  'components/features/auth/LoginForm.tsx',
  'components/features/auth/RegisterForm.tsx',
  'components/features/auth/AuthModal.tsx',
];

const LOCALES: Record<string, [unknown, unknown]> = {
  auth: [enAuth, esAuth],
  common: [enCommon, esCommon],
};

const lookup = (locale: unknown, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      locale,
    );

const usedKeys = (source: string): string[] =>
  [...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1]);

const REQUIRED_KEYS = [
  'verificationRequired',
  'resendingCode',
  'resendCodeSuccessTitle',
  'resendCodeSuccessMsg',
  'accountAlreadyExistsTitle',
  'accountAlreadyExistsMsg',
  'recoveryErrorTitle',
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
  'samePassword',
  'enter6DigitCode',
] as const;

describe('auth locale parity', () => {
  it('resolves every literal key used by the auth screens in both languages', () => {
    const missing: string[] = [];
    for (const file of AUTH_SOURCES) {
      const source = readFileSync(join(FRONTEND_DIR, file), 'utf8');
      for (const used of usedKeys(source)) {
        const [namespace, key] = used.includes(':')
          ? used.split(':')
          : ['auth', used];
        const locales = LOCALES[namespace];
        if (!locales) {
          missing.push(`${file}: unknown namespace in ${used}`);
          continue;
        }
        locales.forEach((locale, index) => {
          if (typeof lookup(locale, key) !== 'string') {
            missing.push(`${file}: ${used} (${index === 0 ? 'en' : 'es'})`);
          }
        });
      }
    }
    expect(missing).toEqual([]);
  });

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
