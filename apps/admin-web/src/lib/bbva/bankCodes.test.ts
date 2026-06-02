import { expect, test } from 'bun:test';
import { getBankCode, SPEI_BANK_CODES } from './bankCodes';

test('known bank returns code', () => {
  expect(getBankCode('BBVA México')).toBe('012');
});

test('leading zero preserved', () => {
  expect(getBankCode('Banorte / IXE')).toBe('072');
});

test('unknown bank throws', () => {
  expect(() => getBankCode('Unknown Bank')).toThrow('Banco no soportado: Unknown Bank');
});

test('case insensitive lookup', () => {
  expect(getBankCode('bbva méxico')).toBe('012');
});

test('alias resolves to same code', () => {
  expect(getBankCode('BBVA')).toBe('012');
});

test('STP code', () => {
  expect(getBankCode('STP')).toBe('600');
});

test('SPEI_BANK_CODES is a Map with entries', () => {
  expect(SPEI_BANK_CODES instanceof Map).toBe(true);
  expect(SPEI_BANK_CODES.size).toBeGreaterThan(0);
});
