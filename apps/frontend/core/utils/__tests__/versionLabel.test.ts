import { expect, test, describe } from 'bun:test';
import { formatVersionLabel } from '../versionLabel';

/**
 * Covers EXTD-TASK-011 + CONF-014: "Selene vX.Y.Z (Build N)" format,
 * falls back to "unknown" placeholders when expo-constants is empty.
 */
describe('formatVersionLabel', () => {
  test('formats full version + build', () => {
    expect(formatVersionLabel('1.2.3', '17')).toBe('Selene v1.2.3 (Build 17)');
  });

  test('formats numeric build (Android versionCode)', () => {
    expect(formatVersionLabel('2.0.0', 42)).toBe('Selene v2.0.0 (Build 42)');
  });

  test('falls back to unknown when version is missing', () => {
    expect(formatVersionLabel(undefined, '17')).toBe(
      'Selene vunknown (Build 17)',
    );
  });

  test('falls back to unknown when build is missing', () => {
    expect(formatVersionLabel('1.0.0', undefined)).toBe(
      'Selene v1.0.0 (Build unknown)',
    );
  });

  test('handles both missing', () => {
    expect(formatVersionLabel(undefined, undefined)).toBe(
      'Selene vunknown (Build unknown)',
    );
  });

  test('handles null inputs as unknown', () => {
    expect(formatVersionLabel(null, null)).toBe(
      'Selene vunknown (Build unknown)',
    );
  });
});
