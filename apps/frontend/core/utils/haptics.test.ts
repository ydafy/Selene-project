import { describe, expect, it } from 'bun:test';

import { triggerHaptic } from './haptics';

type FakeHaptics = {
  ImpactFeedbackStyle: { Light: string; Medium: string };
  impactAsync: (style: string) => Promise<void>;
};

describe('triggerHaptic', () => {
  it('calls impactAsync with the light style by default', async () => {
    let capturedStyle: string | null = null;
    const fakeHaptics: FakeHaptics = {
      ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
      impactAsync: async (style) => {
        capturedStyle = style;
      },
    };

    await triggerHaptic(undefined, fakeHaptics as never);
    expect(capturedStyle).toBe('light');
  });

  it('calls impactAsync with the requested style', async () => {
    let capturedStyle: string | null = null;
    const fakeHaptics: FakeHaptics = {
      ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
      impactAsync: async (style) => {
        capturedStyle = style;
      },
    };

    await triggerHaptic('medium' as never, fakeHaptics as never);
    expect(capturedStyle).toBe('medium');
  });

  it('swallows errors without throwing', async () => {
    const fakeHaptics: FakeHaptics = {
      ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
      impactAsync: async () => {
        throw new Error('haptics unavailable');
      },
    };

    await expect(
      triggerHaptic(undefined, fakeHaptics as never),
    ).resolves.toBeUndefined();
  });

  it('returns early when no haptics implementation is available', async () => {
    await expect(triggerHaptic(undefined, null as never)).resolves.toBeUndefined();
  });
});
