import { afterEach, expect, mock, test } from 'bun:test';
import React from 'react';

if (process.env.SELENE_ONBOARDING_NOTICE_CHILD !== '1') {
  test('mounts the onboarding notice announcement in an isolated process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_ONBOARDING_NOTICE_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (child.exitCode !== 0)
      throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const announce = mock<(message: string) => void>(() => {});
  mock.module('react-native', () => ({
    StyleSheet: { flatten: (style: unknown) => style },
    AccessibilityInfo: { announceForAccessibility: announce },
  }));
  const { render } = await import('@testing-library/react-native');
  const { useAnnounceOnboardingNotice } =
    await import('./use-announce-onboarding-notice');
  const Probe = ({ message }: { message: string | null }) => {
    useAnnounceOnboardingNotice(message);
    return null;
  };
  let view: Awaited<ReturnType<typeof render>> | undefined;
  afterEach(async () => {
    await view?.unmount();
    view = undefined;
    announce.mockClear();
  });

  test('announces nothing without a notice', async () => {
    view = await render(<Probe message={null} />);
    expect(announce).toHaveBeenCalledTimes(0);
  });

  test('announces a notice shown on mount once, and again only when it changes', async () => {
    view = await render(<Probe message="El formulario se cerró." />);
    expect(announce.mock.calls).toEqual([['El formulario se cerró.']]);

    await view.rerender(<Probe message="El formulario se cerró." />);
    expect(announce).toHaveBeenCalledTimes(1);

    await view.rerender(<Probe message={null} />);
    expect(announce).toHaveBeenCalledTimes(1);

    await view.rerender(
      <Probe message="Stripe necesita que corrijas un dato." />,
    );
    expect(announce.mock.calls).toEqual([
      ['El formulario se cerró.'],
      ['Stripe necesita que corrijas un dato.'],
    ]);
  });
}
