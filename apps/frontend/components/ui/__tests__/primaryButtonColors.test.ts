import { describe, expect, test } from 'bun:test';
import { colors } from '../../../core/theme/tokens';
import { getTextColor } from '../primaryButtonColors';

describe('PrimaryButton text color', () => {
  test('gold buttons keep dark text, also while loading', () => {
    expect(getTextColor(false, 'solid', undefined, colors)).toBe(colors.background);
    expect(getTextColor(true, 'solid', undefined, colors)).toBe(colors.background);
  });

  test('a loading button with a custom color uses light text for contrast', () => {
    expect(getTextColor(true, 'solid', colors.cardBackground, colors)).toBe(colors.textPrimary);
  });

  test('outline buttons keep gold text', () => {
    expect(getTextColor(false, 'outline', undefined, colors)).toBe(colors.primary);
  });
});
