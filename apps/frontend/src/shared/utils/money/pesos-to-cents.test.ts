import { describe, expect, it } from 'bun:test';

import {
  centsToPesosInput,
  pesosToCents,
  tryPesosToCents,
} from './pesos-to-cents';

describe('pesosToCents', () => {
  it.each([
    ['1000.00', 100_000],
    ['150.5', 15_050],
    [19.99, 1_999],
    ['0', 0],
    [0, 0],
    [1000, 100_000],
    [' 42.1 ', 4_210],
    [2508.23, 250_823],
    [0.29, 29],
    [1.005, 101],
    [500_000, 50_000_000],
  ])('converts %p pesos to %i cents', (pesos, cents) => {
    expect(pesosToCents(pesos)).toBe(cents);
  });

  it('never returns negative zero', () => {
    expect(Object.is(pesosToCents('-0'), 0)).toBe(true);
  });

  it.each([
    -1,
    '-0.01',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    '',
    '   ',
    'abc',
    '12abc',
    'Infinity',
    Number.MAX_SAFE_INTEGER,
  ])('rejects %p with INVALID_PESOS_AMOUNT', (pesos) => {
    expect(() => pesosToCents(pesos)).toThrow('INVALID_PESOS_AMOUNT');
  });
});

describe('tryPesosToCents', () => {
  it('converts valid pesos like pesosToCents', () => {
    expect(tryPesosToCents('150.5')).toBe(15_050);
    expect(tryPesosToCents(19.99)).toBe(1_999);
  });

  it.each(['', '12abc', '-5', Number.NaN])(
    'returns null for %p instead of throwing',
    (pesos) => {
      expect(tryPesosToCents(pesos)).toBeNull();
    },
  );
});

describe('centsToPesosInput', () => {
  it.each([
    [100_000, '1000'],
    [15_050, '150.50'],
    [1_999, '19.99'],
    [1, '0.01'],
    [0, '0'],
    [50_000_000, '500000'],
  ])('formats %i cents as the pesos input %p', (cents, text) => {
    expect(centsToPesosInput(cents)).toBe(text);
  });

  it.each([100_000, 15_050, 1_999, 1, 0])(
    'round-trips %i cents through pesosToCents',
    (cents) => {
      expect(pesosToCents(centsToPesosInput(cents))).toBe(cents);
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %p with INVALID_CENTS_AMOUNT',
    (cents) => {
      expect(() => centsToPesosInput(cents)).toThrow('INVALID_CENTS_AMOUNT');
    },
  );
});
