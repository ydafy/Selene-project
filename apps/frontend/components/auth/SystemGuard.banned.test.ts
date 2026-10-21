import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import enAuth from '../../core/i18n/locales/en/auth.json';
import esAuth from '../../core/i18n/locales/es/auth.json';

const guardSource = readFileSync(join(import.meta.dir, 'SystemGuard.tsx'), 'utf8');

describe('banned account screen copy', () => {
  it('defines the banned screen copy in English and Spanish', () => {
    for (const locale of [enAuth, esAuth]) {
      expect(Object.keys(locale.bannedAccount).sort()).toEqual([
        'defaultMessage',
        'signOut',
        'title',
      ]);
    }
    expect(enAuth.bannedAccount.title).toBe('Account banned');
    expect(esAuth.bannedAccount.title).toBe('Cuenta bloqueada');
  });

  it('never labels a ban as a suspension', () => {
    expect(esAuth.bannedAccount.title.toLowerCase()).not.toContain('suspend');
    expect(enAuth.bannedAccount.title.toLowerCase()).not.toContain('suspend');
  });
});

describe('SystemGuard banned screen source contract', () => {
  it('renders the banned copy through i18n instead of hardcoded Spanish', () => {
    expect(guardSource).toContain("t('auth:bannedAccount.title')");
    expect(guardSource).toContain("t('auth:bannedAccount.defaultMessage')");
    expect(guardSource).toContain("t('auth:bannedAccount.signOut')");
    expect(guardSource).not.toContain('CUENTA SUSPENDIDA');
    expect(guardSource).not.toContain('dada de baja permanentemente');
  });

  it('passes a resolved theme color to the icon, not a theme path string', () => {
    expect(guardSource).not.toContain('"theme.colors.error"');
    expect(guardSource).toContain('color={theme.colors.error}');
  });
});
