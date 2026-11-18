import { expect, mock, test } from 'bun:test';

// Bun shares its module registry across suite files; a child isolates the mocks
// from unrelated tests that have already imported the real modules.
if (process.env.SELENE_MODERATION_HOOK_CHILD !== '1') {
  test('useModeration reports through a plain insert (isolated)', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_MODERATION_HOOK_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (child.exitCode !== 0)
      throw new Error(
        new TextDecoder().decode(child.stdout) +
          new TextDecoder().decode(child.stderr),
      );
    expect(child.exitCode).toBe(0);
  });
} else {
  mock.module('react-native', () => ({
    StyleSheet: {
      create: <T>(styles: T) => styles,
      flatten: (s: unknown) => s,
    },
  }));
  let insertResult: { error: unknown } = { error: null };
  const select = mock(() => {
    throw new Error('reports cannot be read back by authenticated');
  });
  const insert = mock<(...args: unknown[]) => unknown>(() => {
    // A thenable like PostgREST's builder, with `.select()` available.
    const builder = Promise.resolve(insertResult) as Promise<{
      error: unknown;
    }> & { select: typeof select };
    builder.select = select;
    return builder;
  });
  const from = mock<(table: string) => unknown>(() => ({ insert }));
  mock.module('@/shared/lib/supabase', () => ({ supabase: { from } }));
  let session: { user: { id: string } } | null = { user: { id: 'me' } };
  mock.module('@/shared/lib/auth/auth-provider', () => ({
    useAuthContext: () => ({ session }),
  }));

  const { act, renderHook } = await import('@testing-library/react-native');
  const { useModeration } = await import('./use-moderation');

  const report = async (outcome: { error: unknown }) => {
    insertResult = outcome;
    const view = await renderHook(() => useModeration());
    let result: unknown;
    await act(async () => {
      result = await view.result.current.reportEntity({
        target: { context: 'user', id: 'u1' },
        reason: 'spam',
        details: ' bots ',
      });
    });
    return { result, loading: view.result.current.loading };
  };

  test('inserts the user report with a plain insert and maps success', async () => {
    insert.mockClear();
    const { result, loading } = await report({ error: null });
    expect(from).toHaveBeenCalledWith('reports');
    expect(insert).toHaveBeenCalledTimes(1);
    // No options: the default return=minimal never reads the row back.
    expect(insert.mock.calls[0]).toEqual([
      {
        reporter_id: 'me',
        target_user_id: 'u1',
        reason: 'spam',
        details: 'bots',
      },
    ]);
    expect(select).not.toHaveBeenCalled();
    expect(result).toBe('success');
    expect(loading).toBe(false);
  });

  test('maps a duplicate open report and other failures', async () => {
    expect((await report({ error: { code: '23505' } })).result).toBe(
      'already_reported',
    );
    expect((await report({ error: { code: '42501' } })).result).toBe('error');
  });

  test('without a session nothing is inserted', async () => {
    insert.mockClear();
    session = null;
    expect((await report({ error: null })).result).toBe('error');
    expect(insert).not.toHaveBeenCalled();
    session = { user: { id: 'me' } };
  });
}
