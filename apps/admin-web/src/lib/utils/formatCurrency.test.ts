import { expect, test } from 'bun:test';
import { formatCurrency } from './formatCurrency';

test('formatCurrency formats zero as MX$0', () => {
  expect(formatCurrency(0)).toBe('$0');
});

test('formatCurrency formats whole thousands with commas', () => {
  expect(formatCurrency(1500)).toBe('$1,500');
});

test('formatCurrency formats millions', () => {
  expect(formatCurrency(1_000_000)).toBe('$1,000,000');
});

test('formatCurrency formats decimal values', () => {
  expect(formatCurrency(99.99)).toBe('$99.99');
});

test('formatCurrency formats large decimal values', () => {
  expect(formatCurrency(1234567.89)).toBe('$1,234,567.89');
});
