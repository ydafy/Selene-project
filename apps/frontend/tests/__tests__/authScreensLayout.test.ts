import { expect, test, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Source-contract tests for the auth screen layout (T7b, U1 + U5).
 * bun:test cannot mount React Native, so these pin the wiring in source.
 */

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relPath: string) => readFileSync(join(FRONTEND, relPath), 'utf8');

const AUTH_SCREENS = [
  'forgotPassword',
  'verify-code',
  'resetPassword',
];

describe('ScreenLayout keyboard awareness is opt-in', () => {
  const src = read('components/layout/ScreenLayout.tsx');

  test('declares an optional keyboardAware prop', () => {
    expect(src).toMatch(/keyboardAware\?: boolean/);
  });

  test('only subscribes to the keyboard when opted in on Android', () => {
    expect(src).toContain('useKeyboardHeight(');
    expect(src).toMatch(/keyboardAware\s*&&\s*Platform\.OS === 'android'/);
  });

  test('keeps the iOS KeyboardAvoidingView padding behavior', () => {
    expect(src).toContain(
      "behavior={Platform.OS === 'ios' ? 'padding' : undefined}",
    );
  });

  test('applies the keyboard height as bottom padding only when non-zero', () => {
    expect(src).toMatch(/keyboardHeight\s*>\s*0/);
    expect(src).toMatch(/paddingBottom:\s*keyboardHeight/);
  });
});

describe.each(AUTH_SCREENS)('auth screen %s', (name) => {
  const src = read(`app/(auth)/${name}.tsx`);

  test('opts in to keyboard-aware layout', () => {
    expect(src).toContain('<ScreenLayout keyboardAware>');
  });

  test('does not offset the back button by insets.top a second time', () => {
    expect(src).not.toContain('insets.top');
    expect(src).not.toContain('useSafeAreaInsets');
    expect(src).not.toContain('position="absolute"');
  });

  test('uses the shared AuthBackButton', () => {
    expect(src).toContain('<AuthBackButton />');
  });
});

describe('AuthBackButton', () => {
  const src = read('components/features/auth/AuthBackButton.tsx');

  test('keeps icon, size, color and router.back() behavior', () => {
    expect(src).toContain('icon="arrow-left"');
    expect(src).toContain('size={28}');
    expect(src).toContain('iconColor={theme.colors.textPrimary}');
    expect(src).toContain('router.back()');
  });

  test('is a normal row, not absolutely positioned or inset-offset', () => {
    expect(src).not.toContain('position="absolute"');
    expect(src).not.toContain('insets');
  });
});
