import { afterEach, describe, expect, it, mock, test } from 'bun:test';

// Bun shares its module registry across suite files; a child isolates the react-native
// mock RNTL needs from unrelated tests that have already imported the native entrypoint.
if (process.env.SELENE_ORDER_COUNTDOWN_CHILD !== '1') {
  test('useOrderCountdown counts down, expires and resets (isolated)', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_ORDER_COUNTDOWN_CHILD: '1' },
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

  const { renderHook } = await import('@testing-library/react-native');
  const { useOrderCountdown } = await import('./use-order-countdown');

  type Props = { start?: string | null; hours?: number };

  async function renderCountdown(initial: Props) {
    const view = await renderHook(
      (props: Props) => useOrderCountdown(props.start, props.hours),
      { initialProps: initial },
    );
    return {
      get: () => view.result.current,
      update: (next: Props) => view.rerender(next),
      unmount: () => view.unmount(),
    };
  }

  const hoursAgo = (h: number) =>
    new Date(Date.now() - h * 3600_000).toISOString();
  let mounted: { unmount: () => Promise<void> } | null = null;
  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
  });

  describe('useOrderCountdown', () => {
    it('counts down from a start time inside the window', async () => {
      const view = await renderCountdown({ start: hoursAgo(1), hours: 48 });
      mounted = view;
      const { timeLeft, isExpired, hoursRemaining } = view.get();
      expect(timeLeft).toMatch(/^4[67]h \d{2}m$/);
      expect(isExpired).toBe(false);
      expect(hoursRemaining).toBeGreaterThanOrEqual(46);
    });

    it('reports an expired window', async () => {
      const view = await renderCountdown({ start: hoursAgo(50), hours: 48 });
      mounted = view;
      expect(view.get()).toEqual({
        timeLeft: '00h 00m',
        isExpired: true,
        hoursRemaining: 0,
      });
    });

    it('resets to the idle state when the start time becomes null', async () => {
      const view = await renderCountdown({ start: hoursAgo(50), hours: 48 });
      mounted = view;
      expect(view.get().isExpired).toBe(true);

      await view.update({ start: null, hours: 48 });

      expect(view.get()).toEqual({
        timeLeft: '--h --m',
        isExpired: false,
        hoursRemaining: 48,
      });
    });

    it('also resets when the start time is undefined or invalid', async () => {
      const view = await renderCountdown({ start: hoursAgo(1), hours: 24 });
      mounted = view;
      await view.update({ start: 'not-a-date', hours: 24 });
      expect(view.get()).toEqual({
        timeLeft: '--h --m',
        isExpired: false,
        hoursRemaining: 24,
      });
    });
  });
}
