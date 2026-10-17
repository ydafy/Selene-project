import { expect, mock, test } from 'bun:test';
import React from 'react';
// @ts-expect-error The installed test-only renderer has no local type declarations.
import { act, create } from 'react-test-renderer';

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
    PrimaryButton: host('PrimaryButton'),
  }));

  const { ShipmentLabelRecoveryCard } =
    await import('../../components/features/orders/ShipmentLabelRecoveryCard');

  test('pending, uncertain and unavailable states expose only status and support actions', async () => {
    const onRefresh = mock(() => {});
    const onSupport = mock(() => {});
    let tree: ReturnType<typeof create>;
    for (const state of [
      'processing',
      'reconciliation',
      'unavailable',
    ] as const) {
      await act(async () => {
        tree = create(
          <ShipmentLabelRecoveryCard
            state={state}
            isRefreshing={false}
            disabled={false}
            onRefresh={onRefresh}
            onSupport={onSupport}
          />,
        );
      });
      const text = JSON.stringify(tree!.toJSON());
      expect(text).toContain(`prepare.recovery.${state}Title`);
      expect(text).toContain(`prepare.recovery.${state}Body`);
      const buttons = tree!.root.findAllByType('PrimaryButton');
      expect(buttons).toHaveLength(2);
      expect(buttons[0].props.children).toBe('prepare.recovery.refresh');
      expect(buttons[1].props.children).toBe('prepare.recovery.support');
      await act(async () => {
        buttons[0].props.onPress();
        buttons[1].props.onPress();
      });
      expect(text).not.toContain('prepare.confirmBtn');
      await act(async () => {
        tree!.update(
          <ShipmentLabelRecoveryCard
            state={state}
            isRefreshing
            disabled={false}
            onRefresh={onRefresh}
            onSupport={onSupport}
          />,
        );
      });
      expect(
        tree!.root
          .findAllByType('PrimaryButton')
          .every(
            (button: { props: { disabled: boolean } }) => button.props.disabled,
          ),
      ).toBe(true);
      await act(async () => {
        tree!.update(
          <ShipmentLabelRecoveryCard
            state={state}
            isRefreshing={false}
            disabled
            onRefresh={onRefresh}
            onSupport={onSupport}
          />,
        );
      });
      expect(
        tree!.root
          .findAllByType('PrimaryButton')
          .every(
            (button: { props: { disabled: boolean } }) => button.props.disabled,
          ),
      ).toBe(true);
      await act(async () => {
        tree!.unmount();
      });
    }
    expect(onRefresh).toHaveBeenCalledTimes(3);
    expect(onSupport).toHaveBeenCalledTimes(3);
  });
}
