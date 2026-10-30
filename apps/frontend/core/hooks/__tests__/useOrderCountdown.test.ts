import { afterEach, describe, expect, it } from 'bun:test';
import React from 'react';
// @ts-expect-error The installed test-only renderer has no local declarations.
import TestRenderer, { act } from 'react-test-renderer';

import { useOrderCountdown } from '../useOrderCountdown';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Result = ReturnType<typeof useOrderCountdown>;

function renderCountdown(initial: { start?: string | null; hours?: number }) {
  let latest!: Result;
  const Probe = (props: { start?: string | null; hours?: number }) => {
    latest = useOrderCountdown(props.start, props.hours);
    return null;
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Probe, initial));
  });
  return {
    get: () => latest,
    update: (next: { start?: string | null; hours?: number }) =>
      act(() => renderer.update(React.createElement(Probe, next))),
    unmount: () => act(() => renderer.unmount()),
  };
}

const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 3600_000).toISOString();
let mounted: { unmount: () => void } | null = null;
afterEach(() => mounted?.unmount());

describe('useOrderCountdown', () => {
  it('counts down from a start time inside the window', () => {
    mounted = renderCountdown({ start: hoursAgo(1), hours: 48 });
    const { timeLeft, isExpired, hoursRemaining } = (
      mounted as ReturnType<typeof renderCountdown>
    ).get();
    expect(timeLeft).toMatch(/^4[67]h \d{2}m$/);
    expect(isExpired).toBe(false);
    expect(hoursRemaining).toBeGreaterThanOrEqual(46);
  });

  it('reports an expired window', () => {
    mounted = renderCountdown({ start: hoursAgo(50), hours: 48 });
    const r = (mounted as ReturnType<typeof renderCountdown>).get();
    expect(r).toEqual({
      timeLeft: '00h 00m',
      isExpired: true,
      hoursRemaining: 0,
    });
  });

  it('resets to the idle state when the start time becomes null', () => {
    const view = renderCountdown({ start: hoursAgo(50), hours: 48 });
    mounted = view;
    expect(view.get().isExpired).toBe(true);

    view.update({ start: null, hours: 48 });

    expect(view.get()).toEqual({
      timeLeft: '--h --m',
      isExpired: false,
      hoursRemaining: 48,
    });
  });

  it('also resets when the start time is undefined or invalid', () => {
    const view = renderCountdown({ start: hoursAgo(1), hours: 24 });
    mounted = view;
    view.update({ start: 'not-a-date', hours: 24 });
    expect(view.get()).toEqual({
      timeLeft: '--h --m',
      isExpired: false,
      hoursRemaining: 24,
    });
  });
});
