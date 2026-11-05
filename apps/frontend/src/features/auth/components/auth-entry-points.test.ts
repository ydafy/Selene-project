import { expect, test, describe } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Source-contract tests for T7e: sign-in and registration only open through
 * AuthModal. The stack screens that remain are the ones the modal navigates to.
 */

const FRONTEND = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const read = (relPath: string) => readFileSync(join(FRONTEND, relPath), 'utf8');

describe('auth entry points', () => {
  test('the stack login and register screens no longer exist', () => {
    expect(existsSync(join(FRONTEND, 'src/app/(auth)/login.tsx'))).toBe(false);
    expect(existsSync(join(FRONTEND, 'src/app/(auth)/register.tsx'))).toBe(
      false,
    );
  });

  test('the auth stack declares only the screens the modal navigates to', () => {
    const layout = read('src/app/(auth)/_layout.tsx');
    expect(layout).not.toContain('name="login"');
    expect(layout).not.toContain('name="register"');
    for (const name of ['forgotPassword', 'resetPassword', 'verify-code']) {
      expect(layout).toContain(`name="${name}"`);
    }
  });

  test('the guest profile opens the modal for both sign-in and registration', () => {
    const profile = read('src/app/(tabs)/profile.tsx');
    expect(profile).toContain("present('login')");
    expect(profile).toContain("present('register')");
    expect(profile).not.toContain("router.push('/register')");
  });

  test('verify-code without an email returns to the tabs, not to a removed screen', () => {
    const verify = read('src/app/(auth)/verify-code.tsx');
    expect(verify).not.toContain('/(auth)/register');
    expect(verify).toContain("router.replace('/(tabs)')");
  });

  test('no source navigates to the removed routes', () => {
    for (const file of [
      'src/app/(tabs)/profile.tsx',
      'src/app/(auth)/verify-code.tsx',
      'src/features/auth/components/auth-modal.tsx',
    ]) {
      const src = read(file);
      expect(src).not.toMatch(/['"]\/(\(auth\)\/)?(login|register)['"]/);
    }
  });
});
