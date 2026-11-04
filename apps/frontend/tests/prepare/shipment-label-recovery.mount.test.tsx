import { expect, mock, test } from 'bun:test';
import React from 'react';

if (process.env.SELENE_LABEL_RECOVERY_CHILD !== '1') {
  test('mounts label recovery actions in an isolated process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_LABEL_RECOVERY_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (child.exitCode !== 0)
      throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host =
    (name: string) =>
    ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(name, props, children);
  mock.module('react-native', () => ({
    StyleSheet: { flatten: (style: unknown) => style },
  }));
  mock.module('@expo/vector-icons', () => ({
    MaterialCommunityIcons: host('Icon'),
  }));
  mock.module('@shopify/restyle', () => ({
    useTheme: () => ({ colors: { primary: 'blue' } }),
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
  }));
  mock.module('../../components/base', () => ({
    Box: host('Box'),
    Text: host('Text'),
  }));
  mock.module('../../components/ui/PrimaryButton', () => ({
    // The library only accepts strings inside a text host, so the label sits in one.
    PrimaryButton: ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(
        'PrimaryButton',
        props,
        React.createElement('Text', null, children),
      ),
  }));

  const { act, render } = await import('@testing-library/react-native');
  const { ShipmentLabelRecoveryCard } =
    await import('../../components/features/orders/ShipmentLabelRecoveryCard');

  test('pending, uncertain and unavailable states expose only status and support actions', async () => {
    const onRefresh = mock(() => {});
    const onSupport = mock(() => {});
    const card = (
      state: string,
      flags: { refreshing?: boolean; off?: boolean },
    ) => (
      <ShipmentLabelRecoveryCard
        state={state as 'processing'}
        isRefreshing={flags.refreshing ?? false}
        disabled={flags.off ?? false}
        onRefresh={onRefresh}
        onSupport={onSupport}
      />
    );
    for (const state of [
      'processing',
      'reconciliation',
      'unavailable',
    ] as const) {
      const view = await render(card(state, {}));
      const buttons = () =>
        view.container.queryAll((node) => node.type === 'PrimaryButton');
      const text = JSON.stringify(view.toJSON());
      expect(text).toContain(`prepare.recovery.${state}Title`);
      expect(text).toContain(`prepare.recovery.${state}Body`);
      expect(buttons()).toHaveLength(2);
      const label = (button: ReturnType<typeof buttons>[number]) =>
        button
          .queryAll((node) => node.type === 'Text')
          .map((node) => node.props.children)
          .join('');
      expect(label(buttons()[0])).toBe('prepare.recovery.refresh');
      expect(label(buttons()[1])).toBe('prepare.recovery.support');
      // The stand-in is not a pressable host, so the handlers are invoked directly.
      await act(async () => {
        (buttons()[0].props.onPress as () => void)();
        (buttons()[1].props.onPress as () => void)();
      });
      expect(text).not.toContain('prepare.confirmBtn');
      await view.rerender(card(state, { refreshing: true }));
      expect(buttons().every((button) => button.props.disabled)).toBe(true);
      await view.rerender(card(state, { off: true }));
      expect(buttons().every((button) => button.props.disabled)).toBe(true);
      await view.unmount();
    }
    expect(onRefresh).toHaveBeenCalledTimes(3);
    expect(onSupport).toHaveBeenCalledTimes(3);
  });
}
