import { expect, test, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Asserts every new settings key introduced by account-settings-extended
 * is present in both ES and EN locale files. Covers CONF-020 + EXTD-TASK-002.
 */

const LOCALES_DIR = join(import.meta.dir, '..', 'locales');

const loadLocale = (lang: 'es' | 'en'): Record<string, unknown> => {
  return JSON.parse(
    readFileSync(join(LOCALES_DIR, lang, 'settings.json'), 'utf8'),
  );
};

const NEW_KEYS = [
  // Legales
  'sections.legal',
  'sections.support',
  'legales.terms',
  'legales.privacy',
  'legales.versionLabel',
  'legales.sectionTitle',
  // Edit profile
  'editProfile.title',
  'editProfile.usernameLabel',
  'editProfile.save',
  'editProfile.cancel',
  // Account email change
  'account.emailLabel',
  'account.emailChangeTitle',
  'account.emailChangeMessage',
  'account.emailChangeAction',
  'account.biometricPrompt',
  'account.biometricFallback',
  'account.biometricFailed',
  'account.googleProviderHint',
  // Security password change
  'security.passwordTitle',
  'security.googleProviderHint',
  'security.passwordNew',
  'security.passwordConfirm',
  'security.passwordChangeAction',
  'security.passwordMismatch',
  'security.passwordTooShort',
  'security.biometricPrompt',
  'security.biometricFallback',
  'security.biometricFailed',
  // Support
  'support.title',
  'support.description',
  'support.unavailable',
  // Toasts
  'toasts.emailSentTitle',
  'toasts.emailSentMessage',
  'toasts.passwordUpdatedTitle',
  'toasts.passwordUpdatedMessage',
  'toasts.profileUpdatedTitle',
  'toasts.profileUpdatedMessage',
  // Errors
  'errors.invalidEmail',
  'errors.wrongPassword',
  'errors.browserNotFound',
] as const;

const getNested = (obj: Record<string, unknown>, path: string): unknown => {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj,
    );
};

describe('settings i18n keys (account-settings-extended)', () => {
  const es = loadLocale('es');
  const en = loadLocale('en');

  for (const key of NEW_KEYS) {
    test(`ES locale has settings.${key}`, () => {
      const value = getNested(es, key);
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    });

    test(`EN locale has settings.${key}`, () => {
      const value = getNested(en, key);
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    });
  }

  test('preserves existing base keys (no regression)', () => {
    // Ensure earlier required keys still exist
    for (const baseKey of [
      'title',
      'sections.account',
      'sections.security',
      'sections.privacy',
      'account.usernameLabel',
      'security.logout',
    ]) {
      expect(typeof getNested(es, baseKey)).toBe('string');
      expect(typeof getNested(en, baseKey)).toBe('string');
    }
  });
});
