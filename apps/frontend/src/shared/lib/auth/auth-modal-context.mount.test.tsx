import { expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';

// #134 B1: the auth modal contract lives in shared/ so routes and features can open the
// modal without importing features/auth. Module mocks stay in a child process so they
// cannot leak into other test files.
if (process.env.SELENE_AUTH_MODAL_CHILD !== '1') {
  test('useAuthModal reads the shared context (isolated)', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_AUTH_MODAL_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (child.exitCode !== 0)
      throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });

  test('the context module imports no feature code', () => {
    const source = readFileSync(
      join(import.meta.dir, 'auth-modal-context.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /(?:from\s+|import\(\s*|require\(\s*)['"][^'"]*features\//,
    );
  });
} else {
  mock.module('react-native', () => ({}));

  const { renderHook } = await import('@testing-library/react-native');
  const { AuthModalContext, useAuthModal } =
    await import('./auth-modal-context');

  test('throws outside an AuthModalProvider', async () => {
    let error: unknown;
    try {
      await renderHook(() => useAuthModal());
    } catch (caught) {
      error = caught;
    }
    expect((error as Error | undefined)?.message).toBe(
      'useAuthModal must be used within an AuthModalProvider',
    );
  });

  test('returns the value the provider puts on the context', async () => {
    const value = { present: mock(() => {}), dismiss: mock(() => {}) };
    const { result } = await renderHook(() => useAuthModal(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <AuthModalContext.Provider value={value}>
          {children}
        </AuthModalContext.Provider>
      ),
    });
    expect(result.current).toBe(value);
  });
}
