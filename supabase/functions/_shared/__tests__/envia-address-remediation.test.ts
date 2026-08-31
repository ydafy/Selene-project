import { expect, test } from 'bun:test';

import { normalizeEnviaMexicoStateCode } from '../envia-mexico-states.ts';

test('maps Envia Mexican state aliases to canonical two-character codes', () => {
  expect(normalizeEnviaMexicoStateCode('NLE')).toBe('NL');
  expect(normalizeEnviaMexicoStateCode('CMX')).toBe('CX');
  expect(normalizeEnviaMexicoStateCode('JAL')).toBe('JA');
  expect(normalizeEnviaMexicoStateCode('Nuevo León')).toBeNull();
});
