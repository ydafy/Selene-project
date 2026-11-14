import { describe, expect, it } from 'bun:test';

import { formatCentsWithLocale } from './format-cents-with-locale';

describe('formatCentsWithLocale', () => {
  it('formats MXN cents with en-US locale', () => {
    expect(formatCentsWithLocale(125_050, 'en-US')).toBe('MX$1,250.50');
  });

  it('formats MXN cents with es-MX locale', () => {
    expect(formatCentsWithLocale(125_050, 'es-MX')).toBe('$1,250.50');
  });

  it('uses locale-aware separators for de-DE', () => {
    const result = formatCentsWithLocale(125_050, 'de-DE');
    expect(result).toMatch(/1\.250,50/);
    expect(result).toMatch(/MX\$$/);
  });

  it('formats zero and single cents', () => {
    expect(formatCentsWithLocale(0, 'es-MX')).toBe('$0.00');
    expect(formatCentsWithLocale(1, 'es-MX')).toBe('$0.01');
    expect(formatCentsWithLocale(1_999, 'es-MX')).toBe('$19.99');
  });

  it.each([
    [100_000, 'MX$1,000.00', '$1,000.00'],
    [15_050, 'MX$150.50', '$150.50'],
    [50_000_000, 'MX$500,000.00', '$500,000.00'],
    [250_823, 'MX$2,508.23', '$2,508.23'],
  ])('formats %i cents like the pesos formatter did', (cents, en, es) => {
    expect(formatCentsWithLocale(cents, 'en-US')).toBe(en);
    expect(formatCentsWithLocale(cents, 'es-MX')).toBe(es);
  });

  it('returns $0.00 for a non-finite amount', () => {
    expect(formatCentsWithLocale(Number.NaN, 'en-US')).toBe('$0.00');
    expect(formatCentsWithLocale(Number.POSITIVE_INFINITY, 'en-US')).toBe(
      '$0.00',
    );
  });
});
