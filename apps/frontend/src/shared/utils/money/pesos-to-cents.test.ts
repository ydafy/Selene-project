import { describe, expect, it } from 'bun:test';

import { pesosToCents } from './pesos-to-cents';

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
