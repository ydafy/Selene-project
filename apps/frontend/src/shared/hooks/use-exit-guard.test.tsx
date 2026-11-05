import { expect, mock, test } from 'bun:test';
import React from 'react';

// mock.module leaks across files, so the mount test runs in its own process.
if (process.env.SELENE_EXIT_GUARD_CHILD !== '1') {
  test('exit guard blocks, confirms and cancels through usePreventRemove', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_EXIT_GUARD_CHILD: '1' },
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
  type Action = { type: string };
  type Callback = (options: {
    data: { action: Action };
    repeat: () => void;
  }) => void;

  const dispatch = mock<(action: Action) => void>(() => {});
  // SDK 58: repeat() turns prevention off and replays the blocked action.
  const order: string[] = [];
  const repeated = mock<(action: Action) => void>(() => {
    order.push('repeat');
  });
  const resetDraft = mock(() => {
    order.push('discard');
  });
  let guard: { prevent: boolean; callback: Callback } | null = null;
  let dialog: {
    visible: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  } | null = null;

  mock.module('react-native', () => ({
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
  }));
  mock.module('expo-router', () => ({
    useNavigation: () => ({ dispatch }),
    usePreventRemove: (prevent: boolean, callback: Callback) => {
      guard = { prevent, callback };
    },
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
  }));
  mock.module('../ui/confirm-dialog', () => ({
    ConfirmDialog: (props: NonNullable<typeof dialog>) => {
      dialog = props;
      return null;
    },
  }));

  const { act, render } = await import('@testing-library/react-native');
  const { useExitGuard } = await import('./use-exit-guard');

  const Harness = ({ enabled }: { enabled: boolean }) => {
    const { ExitDialog } = useExitGuard({ enabled, onDiscard: resetDraft });
    return React.createElement(ExitDialog);
  };
  const mount = async (enabled: boolean) => {
    dispatch.mockClear();
    repeated.mockClear();
    resetDraft.mockClear();
    order.length = 0;
    dialog = null;
    return render(React.createElement(Harness, { enabled }));
  };
  const block = (action: Action) =>
    act(() => {
      guard!.callback({ data: { action }, repeat: () => repeated(action) });
    });

  test('prevents removal only while the draft is dirty', async () => {
    await mount(false);
    expect(guard!.prevent).toBe(false);
    await mount(true);
    expect(guard!.prevent).toBe(true);
  });

  test('a REPLACE passes straight through without the dialog', async () => {
    await mount(true);
    const publish = { type: 'REPLACE' };

    await block(publish);

    expect(repeated).toHaveBeenCalledTimes(1);
    expect(repeated).toHaveBeenCalledWith(publish);
    expect(dispatch).not.toHaveBeenCalled();
    expect(dialog!.visible).toBe(false);
    expect(resetDraft).not.toHaveBeenCalled();
  });

  test.each(['GO_BACK', 'POP', 'NAVIGATE'])(
    '%s opens the dialog and confirm replays it exactly once',
    async (type) => {
      await mount(true);
      const action = { type };

      await block(action);
      expect(dialog!.visible).toBe(true);
      expect(repeated).not.toHaveBeenCalled();

      await act(() => dialog!.onConfirm());
      await act(() => dialog!.onConfirm());

      expect(repeated).toHaveBeenCalledTimes(1);
      expect(repeated).toHaveBeenCalledWith(action);
      expect(dispatch).not.toHaveBeenCalled();
      expect(resetDraft).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['discard', 'repeat']);
      expect(dialog!.visible).toBe(false);
    },
  );

  test('cancel keeps the user on the screen and keeps the draft', async () => {
    await mount(true);

    await block({ type: 'GO_BACK' });
    await act(() => dialog!.onCancel());

    expect(dialog!.visible).toBe(false);
    expect(repeated).not.toHaveBeenCalled();
    expect(resetDraft).not.toHaveBeenCalled();
  });
}
