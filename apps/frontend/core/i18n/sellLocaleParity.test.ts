import { describe, expect, it } from 'bun:test';

import enSell from './locales/en/sell.json';
import esSell from './locales/es/sell.json';

/**
 * Recursively collects every dotted key path in a JSON locale object.
 * Leaf primitives (strings) and empty objects both emit their path.
 */
const collectKeys = (value: unknown, prefix = ''): string[] => {
  if (value === null || typeof value !== 'object') {
    return prefix ? [prefix] : [];
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return prefix ? [prefix] : [];
  }

  return entries.flatMap(([key, child]) =>
    collectKeys(child, prefix ? `${prefix}.${key}` : key),
  );
};

describe('sell locale parity', () => {
  it('keeps English and Spanish sell.json keys in sync', () => {
    const enKeys = collectKeys(enSell).sort();
    const esKeys = collectKeys(esSell).sort();

    expect(enKeys).toEqual(esKeys);
  });

  it('has non-empty strings for shared base keys', () => {
    const baseKeys = ['title', 'selectCategory', 'preview.title', 'preview.publish'];

    for (const key of baseKeys) {
      const enValue = key.split('.').reduce<unknown>(
        (acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
        enSell,
      );
      const esValue = key.split('.').reduce<unknown>(
        (acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
        esSell,
      );

      expect(typeof enValue).toBe('string');
      expect(typeof esValue).toBe('string');
      expect((enValue as string).length).toBeGreaterThan(0);
      expect((esValue as string).length).toBeGreaterThan(0);
    }
  });
});
