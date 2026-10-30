import { expect, test, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural integration tests for the account-settings-extended change.
 * Covers EXTD-TASK-012: section rendering order, modal navigation registration,
 * email/password payload assertions, and email support wiring.
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

  test('opens the pages through the shared browser hook', () => {
    expect(src).toContain('useOpenInBrowser');
    expect(read('core/hooks/useOpenInBrowser.ts')).toContain(
      'openBrowserAsync',
    );
  });

  test('legal URLs come only from the domain constants', () => {
    expect(src).toMatch(
      /import \{[^}]*\bPRIVACY_URL\b[^}]*\bTERMS_URL\b[^}]*\} from '@selene\/types'/,
    );
    expect(src).toContain('openUrl(TERMS_URL)');
    expect(src).toContain('openUrl(PRIVACY_URL)');
    expect(src).not.toContain('EXPO_PUBLIC_TERMS_URL');
    expect(src).not.toContain('EXPO_PUBLIC_PRIVACY_URL');
  });
});

describe('modal configuration within the profile stack', () => {
  const rootSrc = read('app/_layout.tsx');
  const profileSrc = read('app/profile/_layout.tsx');

  test('profile/edit declares modal presentation in its own screen', () => {
    const editSrc = read('app/profile/edit.tsx');
    expect(rootSrc).toMatch(
      /<Stack\.Screen\s+name="profile"\s+options=\{\{\s*headerShown:\s*false\s*\}\}\s*\/>/,
    );
    expect(profileSrc).toContain(
      '<Stack screenOptions={{ headerShown: false }}>',
    );
    expect(editSrc).toMatch(
      /<Stack\.Screen\s+options=\{\{[^}]*presentation:\s*'modal'[^}]*\}\}\s*\/>/,
    );
  });

  test('profile/support is registered as modal in the nested profile layout', () => {
    expect(rootSrc).toMatch(
      /<Stack\.Screen\s+name="profile"\s+options=\{\{\s*headerShown:\s*false\s*\}\}\s*\/>/,
    );
    expect(profileSrc).toMatch(
      /<Stack\.Screen\s+name="support"\s+options=\{\{[^}]*presentation:\s*'modal'[^}]*\}\}\s*\/>/,
    );
    expect(read('app/profile/support.tsx')).toMatch(
      /<Stack\.Screen\s+options=\{\{[^}]*presentation:\s*'modal'[^}]*\}\}\s*\/>/,
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

  test('rejects an unchanged address and maps errors by code', () => {
    expect(src).toContain('isSameEmail(emailDraft, email)');
    expect(src).toContain("t('errors.sameEmail')");
    expect(src).toContain('t(mapEmailChangeErrorKey(err))');
    expect(src).not.toContain("includes('already')");
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

  test('imports payload builder and error mapper, never a client nonce', () => {
    expect(src).toContain('buildPasswordUpdatePayload');
    expect(src).toContain('mapPasswordChangeErrorKey');
    expect(src).not.toContain('nonce');
  });

  test('renders 3 password fields (current, new, confirm)', () => {
    expect(src).toContain('security.passwordCurrent');
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
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  test('sends the current password payload to supabase.auth.updateUser', () => {
    expect(src).toMatch(
      /buildPasswordUpdatePayload\(currentPw, newPw\)[\s\S]*supabase\.auth\.updateUser\(payload\)/,
    );
  });

  test('shows each error under the field it belongs to', () => {
    expect(src).toContain('passwordErrorField');
    expect(src).toContain('error={!!pwErrors.current}');
    expect(src).toContain('error={!!pwErrors.new}');
    expect(src).toContain('error={!!pwErrors.confirm}');
  });

  test('keeps the password dialog above the keyboard', () => {
    expect(src).toMatch(
      /<ConfirmDialog[\s\S]*?avoidKeyboard[\s\S]*?icon="lock-reset"/,
    );
  });

  test('shows the mapped error key instead of matching message text', () => {
    expect(src).toContain('showPwError(mapPasswordChangeErrorKey(err))');
    expect(src).toContain('[passwordErrorField(errorKey)]: t(errorKey)');
    expect(src).not.toMatch(/invalid\|wrong\|incorrect/);
  });
});

describe('Soporte email wiring', () => {
  const sectionSrc = read('components/features/settings/SoporteSection.tsx');
  const supportSrc = read('app/profile/support.tsx');

  test('SoporteSection shows unavailable toast when the email is not configured', () => {
    expect(sectionSrc).toContain('resolveSupportEmail');
    expect(sectionSrc).toContain('support.unavailable');
  });

  test('SoporteSection navigates to /profile/support when available', () => {
    expect(sectionSrc).toContain("'/profile/support'");
  });

  test('support screen opens a mailto link and shows the address', () => {
    expect(supportSrc).toContain('buildSupportMailto');
    expect(supportSrc).toContain('Linking.openURL');
    expect(supportSrc).toContain('{email}');
  });

  test('support screen tells the user to write to the address when no mail app opens', () => {
    expect(supportSrc).toContain('support.noMailApp');
  });

  test('no Chatwoot code is left in the app', () => {
    expect(sectionSrc.toLowerCase()).not.toContain('chatwoot');
    expect(supportSrc.toLowerCase()).not.toContain('chatwoot');
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

// Terms and privacy URLs come from `@selene/types` (domain.ts), not from env vars.
describe('.env.example documents the support var (CONF-012)', () => {
  const env = read('.env.example');

  test('contains EXPO_PUBLIC_SUPPORT_EMAIL and no Chatwoot vars', () => {
    expect(env).toContain('EXPO_PUBLIC_SUPPORT_EMAIL');
    expect(env).not.toContain('CHATWOOT');
  });
});

describe('package.json drops the Chatwoot widget', () => {
  test('Chatwoot is not a dependency', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['@chatwoot/react-native-widget']).toBeUndefined();
  });

  test('react-native-webview stays only as the hCaptcha native peer', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['@hcaptcha/react-native-hcaptcha']).toBeDefined();
    expect(pkg.dependencies['react-native-webview']).toBeDefined();
  });
});

describe('ConfirmDialog keyboard handling (L62)', () => {
  const src = read('components/ui/ConfirmDialog.tsx');

  test('reserves the keyboard height below the dialog only when avoidKeyboard is set', () => {
    expect(src).toContain('avoidKeyboard?: boolean');
    expect(src).toMatch(/avoidKeyboard\s*=\s*false/);
    expect(src).toContain('useKeyboardHeight(avoidKeyboard)');
    expect(src).toContain('marginBottom: keyboardHeight');
    expect(src).not.toContain('KeyboardAvoidingView');
  });
});
