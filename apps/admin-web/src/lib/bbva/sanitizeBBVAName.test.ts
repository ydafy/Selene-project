import { expect, test } from 'bun:test';
import { sanitizeBBVAName } from './sanitizeBBVAName';

test('strips accents and converts to uppercase', () => {
  expect(sanitizeBBVAName('María Muñoz García')).toBe('MARIA MUNOZ GARCIA');
});

test('removes special characters', () => {
  expect(sanitizeBBVAName('José #1 & Co.')).toBe('JOSE 1 CO');
});

test('null returns empty string', () => {
  expect(sanitizeBBVAName(null)).toBe('');
});

test('undefined returns empty string', () => {
  expect(sanitizeBBVAName(undefined)).toBe('');
});

test('collapses multiple spaces and trims', () => {
  expect(sanitizeBBVAName('  extra   spaces  ')).toBe('EXTRA SPACES');
});

test('handles umlauts', () => {
  expect(sanitizeBBVAName('JÖRG MÜLLER')).toBe('JORG MULLER');
});

test('removes hyphens and converts Ñ to N', () => {
  expect(sanitizeBBVAName('Rodríguez-Fernández')).toBe('RODRIGUEZ FERNANDEZ');
});
