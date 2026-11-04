import { describe, expect, test } from 'bun:test';
import { borderRadii, colors, paperRoundness, palette } from '../tokens';

describe('theme tokens', () => {
  test('exposes every order and shipment state color, including pending', () => {
    expect(colors.pending).toBe(palette.pending);
    for (const state of [
      'pending',
      'paid',
      'preparing',
      'shipped',
      'delivered',
      'completed',
      'cancelled',
      'refunded',
      'dispute',
    ] as const) {
      expect(colors[state]).toBe(palette[state]);
    }
  });

  test('warning is an opaque amber and the translucent red is errorSubtle', () => {
    expect(colors.warning).toBe('#f59e0b');
    expect(colors.errorSubtle).toBe('#dc35451a');
  });

  test('shadows and media backgrounds have their own tokens', () => {
    expect(colors.shadow).toBe('#000000');
    expect(colors.mediaBackground).toBe('#000000');
  });

  test('React Native Paper roundness is on the radii scale', () => {
    expect(paperRoundness).toBe(borderRadii.s);
    expect(Object.values(borderRadii)).toContain(paperRoundness);
  });
});
