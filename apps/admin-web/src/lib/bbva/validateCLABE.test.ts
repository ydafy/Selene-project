import { expect, test } from 'bun:test';
import { validateCLABE } from './validateCLABE';

test('valid CLABE passes', () => {
  const result = validateCLABE('002115070000000004');
  expect(result.valid).toBe(true);
  expect(result.error).toBeUndefined();
});

test('invalid check digit fails', () => {
  const result = validateCLABE('002115070000000005');
  expect(result.valid).toBe(false);
  expect(result.error).toBe('Dígito verificador inválido');
});

test('wrong length fails', () => {
  const result = validateCLABE('0021150700');
  expect(result.valid).toBe(false);
  expect(result.error).toBe('CLABE debe tener 18 dígitos');
});

test('non-numeric fails', () => {
  const result = validateCLABE('00211507000000000A');
  expect(result.valid).toBe(false);
  expect(result.error).toBe('CLABE debe contener solo dígitos');
});

test('empty string fails', () => {
  const result = validateCLABE('');
  expect(result.valid).toBe(false);
  expect(result.error).toBe('CLABE debe tener 18 dígitos');
});

test('known real CLABE passes', () => {
  const result = validateCLABE('002180012345678919');
  expect(result.valid).toBe(true);
  expect(result.error).toBeUndefined();
});
