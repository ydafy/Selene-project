import { expect, test, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Source-contract tests for auth form fields (T7c, U3 + U7).
 * bun:test cannot mount React Native, so these pin the wiring in source.
 */

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relPath: string) => readFileSync(join(FRONTEND, relPath), 'utf8');

/** Returns the `<FormTextInput ... />` element whose label matches. */
const field = (src: string, label: string): string => {
  const start = src.indexOf(`label={t('${label}')}`);
  expect(start).toBeGreaterThan(-1);
  const open = src.lastIndexOf('<FormTextInput', start);
  const close = src.indexOf('/>', start);
  return src.slice(open, close);
};

const LOGIN = 'components/features/auth/LoginForm.tsx';
const REGISTER = 'components/features/auth/RegisterForm.tsx';
const FORGOT = 'app/(auth)/forgotPassword.tsx';
const RESET = 'app/(auth)/resetPassword.tsx';
const VERIFY = 'app/(auth)/verify-code.tsx';

const hints = (auto: string, content: string) => [
  `autoComplete="${auto}"`,
  `textContentType="${content}"`,
];

describe('autofill hints', () => {
  const cases: [string, string, string, string, string][] = [
    [LOGIN, 'emailLabel', 'email', 'emailAddress', 'login email'],
    [LOGIN, 'passwordLabel', 'current-password', 'password', 'login password'],
    [REGISTER, 'usernameLabel', 'username', 'username', 'register username'],
    [REGISTER, 'emailLabel', 'email', 'emailAddress', 'register email'],
    [REGISTER, 'passwordLabel', 'new-password', 'newPassword', 'register pw'],
    [
      REGISTER,
      'confirmPasswordLabel',
      'new-password',
      'newPassword',
      'register confirm',
    ],
    [FORGOT, 'auth:emailLabel', 'email', 'emailAddress', 'forgot email'],
    [RESET, 'auth:newPasswordLabel', 'new-password', 'newPassword', 'reset pw'],
    [
      RESET,
      'auth:confirmPasswordLabel',
      'new-password',
      'newPassword',
      'reset confirm',
    ],
  ];
  for (const [file, label, auto, content, name] of cases) {
    test(`${name} declares ${auto}`, () => {
      const el = field(read(file), label);
      for (const h of hints(auto, content)) expect(el).toContain(h);
    });
  }
});

describe('keyboard flow', () => {
  test('login email goes next to the password through a ref', () => {
    const src = read(LOGIN);
    const email = field(src, 'emailLabel');
    expect(email).toContain('returnKeyType="next"');
    expect(email).toContain('passwordInputRef.current?.focus()');
    const pw = field(src, 'passwordLabel');
    expect(pw).toContain('ref={passwordInputRef}');
    expect(pw).toContain('returnKeyType="done"');
    expect(pw).toContain('onSubmitEditing={submitFromKeyboard}');
  });

  test('login keyboard submit respects the button guards', () => {
    const src = read(LOGIN);
    expect(src).toMatch(
      /submitFromKeyboard = \(\) => \{\s*if \(!isValid \|\| isBusy\) return;/,
    );
  });

  test('register confirm password submits from the keyboard with the button guards', () => {
    const src = read(REGISTER);
    const confirm = field(src, 'confirmPasswordLabel');
    expect(confirm).toContain('returnKeyType="done"');
    expect(confirm).toContain('onSubmitEditing={submitFromKeyboard}');
    expect(src).toContain('disabled={!isValid || isBusy}');
    expect(src).toMatch(
      /submitFromKeyboard = \(\) => \{\s*if \(!isValid \|\| isBusy\) return;/,
    );
  });

  test('forgot password email submits from the keyboard when valid', () => {
    const src = read(FORGOT);
    const el = field(src, 'auth:emailLabel');
    expect(el).toContain('returnKeyType="send"');
    expect(el).toContain('onSubmitEditing={submitFromKeyboard}');
    expect(src).toMatch(
      /submitFromKeyboard = \(\) => \{\s*if \(!isValid \|\| loading\) return;/,
    );
  });

  test('reset password moves new -> confirm -> submit with the button guards', () => {
    const src = read(RESET);
    const pw = field(src, 'auth:newPasswordLabel');
    expect(pw).toContain('returnKeyType="next"');
    expect(pw).toContain('confirmInputRef.current?.focus()');
    const confirm = field(src, 'auth:confirmPasswordLabel');
    expect(confirm).toContain('ref={confirmInputRef}');
    expect(confirm).toContain('returnKeyType="done"');
    expect(confirm).toContain('onSubmitEditing={submitFromKeyboard}');
    expect(src).toContain('disabled={!canSubmit}');
    expect(src).toMatch(
      /submitFromKeyboard = \(\) => \{\s*if \(!canSubmit\) return;/,
    );
  });
});

describe('one field-error style', () => {
  const src = read(REGISTER);
  test('RegisterForm no longer styles errors inline', () => {
    expect(src).not.toContain('marginTop: 4');
    expect(src).not.toContain('theme.colors.error');
  });
  test('RegisterForm errors use the shared Restyle props', () => {
    const matches = src.match(/color="error" marginTop="s" marginLeft="s"/g);
    expect(matches?.length).toBe(4);
  });
});

describe('resend row wraps', () => {
  for (const file of [VERIFY, RESET]) {
    test(`${file} resend row has flexWrap`, () => {
      const src = read(file);
      const idx = src.indexOf("t('auth:didNotReceiveCode')");
      const open = src.lastIndexOf('<Box', idx);
      expect(src.slice(open, idx)).toContain('flexWrap="wrap"');
    });
  }
});

describe('register terms link', () => {
  const src = read(REGISTER);
  test('the terms text opens the terms page from the domain constant', () => {
    expect(src).toMatch(/import \{ TERMS_URL \} from '@selene\/types'/);
    const idx = src.indexOf("{t('termsAndConditions')}");
    expect(idx).toBeGreaterThan(-1);
    const open = src.lastIndexOf('<Text', idx);
    const element = src.slice(open, idx);
    expect(element).toContain('onPress={() => openUrl(TERMS_URL)}');
    expect(element).toContain('accessibilityRole="link"');
  });
});
