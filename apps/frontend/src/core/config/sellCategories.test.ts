import { describe, expect, it } from 'bun:test';

import {
  SELL_CATEGORIES,
  SELL_CATEGORY_META,
  getSellCategoryLabelKey,
} from './sellCategories';

describe('SELL_CATEGORIES', () => {
  it('includes all configured categories', () => {
    expect(SELL_CATEGORIES).toContain('GPU');
    expect(SELL_CATEGORIES).toContain('CPU');
    expect(SELL_CATEGORIES).toContain('Motherboard');
    expect(SELL_CATEGORIES).toContain('RAM');
  });

  it('has no duplicates', () => {
    expect(new Set(SELL_CATEGORIES).size).toBe(SELL_CATEGORIES.length);
  });
});

describe('SELL_CATEGORY_META', () => {
  it('provides a label key and icon for every configured category', () => {
    for (const category of SELL_CATEGORIES) {
      const meta = SELL_CATEGORY_META[category];
      expect(meta).toBeDefined();
      expect(typeof meta.labelKey).toBe('string');
      expect(meta.labelKey.length).toBeGreaterThan(0);
      expect(typeof meta.icon).toBe('string');
      expect(meta.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('getSellCategoryLabelKey', () => {
  it('returns the expected label key for GPU', () => {
    expect(getSellCategoryLabelKey('GPU')).toBe('sell:categories.gpu');
  });

  it('returns the expected label key for Motherboard', () => {
    expect(getSellCategoryLabelKey('Motherboard')).toBe(
      'sell:categories.motherboard',
    );
  });
});
