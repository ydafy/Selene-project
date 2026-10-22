import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Auth block 4 (S7, C3, C4): source-contract tests for the forgot/reset
 * password screens. bun:test cannot mount React Native, so these assert the
 * wiring strings that keep the recovery flow recoverable and localized.
 */

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `error.message` / `error?.message`, but not `error.messageKey`. */
const RAW_MESSAGE = /error\??\.message(?!Key)/;

const read = (relPath: string) => readFileSync(join(FRONTEND, relPath), 'utf8');

describe('resetPassword.tsx', () => {
  const src = read('app/(auth)/resetPassword.tsx');

  test('shows the localized messageKey, never the raw server message', () => {
    expect(src).toContain('messageKey');
    expect(src).not.toMatch(RAW_MESSAGE);
  });

  test('tracks codeVerified so a retry does not re-verify the consumed code', () => {
    expect(src).toContain('codeVerified');
    expect(src).toContain('setCodeVerified(result.codeVerified)');
  });

  test('no longer requires the code input once it is verified', () => {
    expect(src).toContain('!codeVerified && otpCode.length < 6');
  });

  test('offers a resend with cooldown through sendPasswordResetOtp', () => {
    expect(src).toContain('sendPasswordResetOtp');
    expect(src).toContain('useResendCooldown');
    expect(src).toContain('shouldStartCooldown');
    expect(src).toContain("t('auth:resendCodeIn'");
  });

  test('a successful resend clears the previous code from the input', () => {
    expect(src).toContain('ref={otpInputRef}');
    expect(src).toMatch(
      /setCodeVerified\(false\);\s*otpInputRef\.current\?\.clear\(\);\s*setOtpCode\(''\);/,
    );
  });

  test('starts the cooldown on mount because the code was just sent', () => {
    expect(src).toMatch(/useEffect\(\(\) => \{\s*if \(email\) startCooldown\(\);/);
  });

  test('uses i18n keys instead of hardcoded or missing copy', () => {
    expect(src).not.toContain('Falta información');
    expect(src).not.toContain('auth:forgotPassword.errorTitle');
    expect(src).toContain("t('auth:errors.missingEmail')");
    expect(src).toContain("t('auth:recoveryErrorTitle')");
  });
});

describe('forgotPassword.tsx', () => {
  const src = read('app/(auth)/forgotPassword.tsx');

  test('shows the localized messageKey, never the raw server message', () => {
    expect(src).toContain('messageKey');
    expect(src).not.toMatch(RAW_MESSAGE);
  });
});

describe('useAuth.ts recovery wiring', () => {
  const src = read('core/hooks/useAuth.ts');

  test('resetPassword delegates to completePasswordRecovery', () => {
    expect(src).toContain('completePasswordRecovery(supabase.auth');
  });

  test('sendPasswordResetOtp returns failures through toAuthFailure', () => {
    const start = src.indexOf('const sendPasswordResetOtp');
    const end = src.indexOf('const resetPassword');
    expect(src.slice(start, end)).toContain('toAuthFailure(err)');
  });
});
