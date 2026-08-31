import { expect, test, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural integration tests for the account-settings-extended change.
 * Covers EXTD-TASK-012: section rendering order, modal navigation registration,
 * email/password payload assertions, and Chatwoot fallback wiring.
 *
 * These tests read source files and assert key wiring strings exist rather
 * than mounting React Native components (which bun:test cannot render).
 * They prevent regressions where a wiring step is silently removed.
 */

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const read = (relPath: string) => readFileSync(join(FRONTEND, relPath), 'utf8');

describe('settings.tsx renders new sections in spec-required order', () => {
  const src = read('app/profile/settings.tsx');

  test('contains all base sections plus Legales and Soporte', () => {
    expect(src).toContain("t('sections.account')");
    expect(src).toContain("t('sections.security')");
    expect(src).toContain("t('sections.privacy')");
    expect(src).toContain("t('sections.legal')");
    expect(src).toContain("t('sections.support')");
  });

  test('Legales section appears AFTER Privacidad (CONF-011)', () => {
    const privacyIdx = src.indexOf("t('sections.privacy')");
    const legalIdx = src.indexOf("t('sections.legal')");
    expect(privacyIdx).toBeGreaterThan(-1);
    expect(legalIdx).toBeGreaterThan(-1);
    expect(legalIdx).toBeGreaterThan(privacyIdx);
  });

  test('Soporte section appears after Legales', () => {
    const legalIdx = src.indexOf("t('sections.legal')");
    const supportIdx = src.indexOf("t('sections.support')");
    expect(supportIdx).toBeGreaterThan(legalIdx);
  });

  test('imports LegalesSection and SoporteSection', () => {
    expect(src).toContain('LegalesSection');
    expect(src).toContain('SoporteSection');
  });
});

describe('LegalesSection row order (Terms → Privacy → Version)', () => {
  const src = read('components/features/settings/LegalesSection.tsx');

  test('terms row precedes privacy row', () => {
    const termsIdx = src.indexOf("'legales.terms'");
    const privacyIdx = src.indexOf("'legales.privacy'");
    expect(termsIdx).toBeGreaterThan(-1);
    expect(privacyIdx).toBeGreaterThan(termsIdx);
  });

  test('version row is last and non-tappable (showChevron={false})', () => {
    const versionIdx = src.indexOf("'legales.versionLabel'");
    const privacyIdx = src.indexOf("'legales.privacy'");
    expect(versionIdx).toBeGreaterThan(privacyIdx);
    expect(src).toMatch(/showChevron=\{false\}/);
  });

  test('uses expo-web-browser openBrowserAsync', () => {
    expect(src).toContain('openBrowserAsync');
  });
});

describe('modal route registration in app/_layout.tsx', () => {
  const src = read('app/_layout.tsx');

  test('registers profile/edit as modal presentation', () => {
    expect(src).toMatch(/name="profile\/edit"[\s\S]*presentation:\s*'modal'/);
  });

  test('registers profile/support as modal presentation', () => {
    expect(src).toMatch(
      /name="profile\/support"[\s\S]*presentation:\s*'modal'/,
    );
  });
});

describe('AccountSection email-change wiring (CONF-016)', () => {
  const src = read('components/features/settings/AccountSection.tsx');

  test('imports validateEmail + buildEmailUpdatePayload helpers', () => {
    expect(src).toContain('validateEmail');
    expect(src).toContain('buildEmailUpdatePayload');
  });

  test('calls supabase.auth.updateUser with email change result', () => {
    expect(src).toMatch(/supabase\.auth\.updateUser\(/);
    expect(src).toContain('buildEmailUpdatePayload');
  });

  test('shows confirmation-flow toast (emailSentTitle / Message)', () => {
    expect(src).toContain('toasts.emailSentTitle');
    expect(src).toContain('toasts.emailSentMessage');
  });

  test('renders email-outline SettingsRow with onPress opening dialog', () => {
    expect(src).toContain('email-outline');
    expect(src).toContain('setEmailDialogOpen(true)');
  });
});

describe('SecuritySection password-change wiring (CONF-017)', () => {
  const src = read('components/features/settings/SecuritySection.tsx');

  test('imports nonce generator and payload builder', () => {
    expect(src).toContain('generatePasswordNonce');
    expect(src).toContain('buildPasswordUpdatePayload');
  });

  test('renders 2 password fields (new, confirm) — biometric gate replaces current', () => {
    expect(src).toContain('security.passwordNew');
    expect(src).toContain('security.passwordConfirm');
  });

  test('password row appears BEFORE logout row', () => {
    const pwIdx = src.indexOf("'security.passwordTitle'");
    const logoutIdx = src.indexOf("'security.logout'");
    expect(pwIdx).toBeGreaterThan(-1);
    expect(logoutIdx).toBeGreaterThan(pwIdx);
  });

  test('uses secureTextEntry on password fields', () => {
    const matches = src.match(/secureTextEntry/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('generates nonce + calls supabase.auth.updateUser with payload', () => {
    expect(src).toMatch(
      /const nonce = generatePasswordNonce\(\);[\s\S]*supabase\.auth\.updateUser\(payload\)/,
    );
  });

  test('shows wrongPassword error toast on invalid credentials', () => {
    expect(src).toContain('errors.wrongPassword');
  });
});

describe('Chatwoot Soporte fallback wiring (CONF-018)', () => {
  const sectionSrc = read('components/features/settings/SoporteSection.tsx');
  const supportSrc = read('app/profile/support.tsx');

  test('SoporteSection shows unavailable toast when config missing', () => {
    expect(sectionSrc).toContain('resolveChatwootConfig');
    expect(sectionSrc).toContain('support.unavailable');
  });

  test('SoporteSection navigates to /profile/support when available', () => {
    expect(sectionSrc).toContain("'/profile/support'");
  });

  test('support screen tries to require @chatwoot/react-native-widget', () => {
    expect(supportSrc).toContain('@chatwoot/react-native-widget');
  });

  test('support screen falls back to openBrowserAsync on widget failure', () => {
    expect(supportSrc).toContain('openBrowserAsync');
    expect(supportSrc).toContain('buildChatwootChatUrl');
  });
});

describe('profile/edit modal wiring (CONF-015)', () => {
  const src = read('app/profile/edit.tsx');

  test('imports validateEditUsername pure validator', () => {
    expect(src).toContain('validateEditUsername');
  });

  test('uses useUpdateProfile mutation hook', () => {
    expect(src).toContain('useUpdateProfile');
  });

  test('uses useUpdateAvatar mutation hook', () => {
    expect(src).toContain('useUpdateAvatar');
  });

  test('declares Stack.Screen presentation: modal', () => {
    expect(src).toMatch(/presentation:\s*'modal'/);
  });
});

describe('.env.example documents Chatwoot + Legal vars (CONF-018, CONF-012)', () => {
  const env = read('.env.example');

  test('contains EXPO_PUBLIC_CHATWOOT_BASE_URL', () => {
    expect(env).toContain('EXPO_PUBLIC_CHATWOOT_BASE_URL');
  });

  test('contains EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN', () => {
    expect(env).toContain('EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN');
  });

  test('contains EXPO_PUBLIC_TERMS_URL', () => {
    expect(env).toContain('EXPO_PUBLIC_TERMS_URL');
  });

  test('contains EXPO_PUBLIC_PRIVACY_URL', () => {
    expect(env).toContain('EXPO_PUBLIC_PRIVACY_URL');
  });
});

describe('package.json lists @chatwoot/react-native-widget', () => {
  test('dependency entry exists', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['@chatwoot/react-native-widget']).toBeDefined();
  });
});
