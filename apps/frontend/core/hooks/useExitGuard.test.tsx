import { expect, mock, test } from 'bun:test';
import React from 'react';
// @ts-expect-error The installed test-only renderer has no local type declarations.
import { act, create } from 'react-test-renderer';

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
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

  type Action = { type: string };
  type Callback = (options: {
    data: { action: Action };
    repeat: () => void;
  }) => void;

  const dispatch = mock<(action: Action) => void>(() => {});
  // SDK 58: repeat() turns prevention off and replays the blocked action.
  const repeated = mock<(action: Action) => void>(() => {});
  const resetDraft = mock(() => {});
  let guard: { prevent: boolean; callback: Callback } | null = null;
  let dialog: {
    visible: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  } | null = null;

  mock.module('expo-router', () => ({
    useNavigation: () => ({ dispatch }),
    usePreventRemove: (prevent: boolean, callback: Callback) => {
      guard = { prevent, callback };
    },
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
  }));
  mock.module('../store/useSellStore', () => ({
    useSellStore: () => ({ resetDraft }),
  }));
  mock.module('../../components/ui/ConfirmDialog', () => ({
    ConfirmDialog: (props: NonNullable<typeof dialog>) => {
      dialog = props;
      return null;
    },
  }));

  const { useExitGuard } = await import('./useExitGuard');

  const Harness = ({ enabled }: { enabled: boolean }) => {
    const { ExitDialog } = useExitGuard(enabled);
    return React.createElement(ExitDialog);
  };
  const mount = (enabled: boolean) => {
    dispatch.mockClear();
    repeated.mockClear();
    resetDraft.mockClear();
    dialog = null;
    let renderer!: { unmount: () => void };
    act(() => {
      renderer = create(React.createElement(Harness, { enabled }));
    });
    return renderer;
  };
  const block = (action: Action) =>
    act(() => {
      guard!.callback({ data: { action }, repeat: () => repeated(action) });
    });

  test('prevents removal only while the draft is dirty', () => {
    mount(false);
    expect(guard!.prevent).toBe(false);
    mount(true);
    expect(guard!.prevent).toBe(true);
  });

  test('a REPLACE passes straight through without the dialog', () => {
    mount(true);
    const publish = { type: 'REPLACE' };

    block(publish);

    expect(repeated).toHaveBeenCalledTimes(1);
    expect(repeated).toHaveBeenCalledWith(publish);
    expect(dispatch).not.toHaveBeenCalled();
    expect(dialog!.visible).toBe(false);
    expect(resetDraft).not.toHaveBeenCalled();
  });

  test.each(['GO_BACK', 'POP', 'NAVIGATE'])(
    '%s opens the dialog and confirm replays it exactly once',
    (type) => {
      mount(true);
      const action = { type };

      block(action);
      expect(dialog!.visible).toBe(true);
      expect(repeated).not.toHaveBeenCalled();

      act(() => dialog!.onConfirm());
      act(() => dialog!.onConfirm());

      expect(repeated).toHaveBeenCalledTimes(1);
      expect(repeated).toHaveBeenCalledWith(action);
      expect(dispatch).not.toHaveBeenCalled();
      expect(resetDraft).toHaveBeenCalledTimes(1);
      expect(dialog!.visible).toBe(false);
    },
  );

  test('cancel keeps the user on the screen and keeps the draft', () => {
    mount(true);

    block({ type: 'GO_BACK' });
    act(() => dialog!.onCancel());

    expect(dialog!.visible).toBe(false);
    expect(repeated).not.toHaveBeenCalled();
    expect(resetDraft).not.toHaveBeenCalled();
  });
}
