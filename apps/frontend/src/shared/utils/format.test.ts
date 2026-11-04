import { describe, expect, it } from 'bun:test';

import { formatCurrencyWithLocale } from './formatCurrency';

describe('formatCurrencyWithLocale', () => {
  it('formats MXN with en-US locale', () => {
    expect(formatCurrencyWithLocale(1250.5, 'en-US')).toBe('MX$1,250.50');
  });

  it('formats MXN with es-MX locale', () => {
    expect(formatCurrencyWithLocale(1250.5, 'es-MX')).toBe('$1,250.50');
  });

  it('uses locale-aware separators for de-DE', () => {
    const result = formatCurrencyWithLocale(1250.5, 'de-DE');
    expect(result).toMatch(/1\.250,50/);
    expect(result).toMatch(/MX\$$/);
  });

  it('returns $0.00 for null, undefined, or non-numeric strings', () => {
    expect(formatCurrencyWithLocale(null, 'en-US')).toBe('$0.00');
    expect(formatCurrencyWithLocale(undefined, 'en-US')).toBe('$0.00');
    expect(formatCurrencyWithLocale('not-a-number', 'en-US')).toBe('$0.00');
  });

  it('accepts numeric strings', () => {
    expect(formatCurrencyWithLocale('1250.5', 'en-US')).toBe('MX$1,250.50');
  });
});
