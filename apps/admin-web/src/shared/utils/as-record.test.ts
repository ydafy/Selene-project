import { expect, test } from 'bun:test';
import { asRecord, isRecord } from './as-record';

test('asRecord returns the same plain object', () => {
  const value = { code: 'payout_failed', nested: { a: 1 } };
  expect(asRecord(value)).toBe(value);
});

test('asRecord returns an empty object as a record', () => {
  const value = {};
  expect(asRecord(value)).toBe(value);
});

test('asRecord returns null for null, undefined, and arrays', () => {
  expect(asRecord(null)).toBeNull();
  expect(asRecord(undefined)).toBeNull();
  expect(asRecord([])).toBeNull();
  expect(asRecord([{ code: 'x' }])).toBeNull();
});

test('asRecord returns null for primitives', () => {
  expect(asRecord('text')).toBeNull();
  expect(asRecord(0)).toBeNull();
  expect(asRecord(true)).toBeNull();
  expect(asRecord(10n)).toBeNull();
  expect(asRecord(Symbol('s'))).toBeNull();
});

test('isRecord is true only for plain objects', () => {
  expect(isRecord({ a: 1 })).toBe(true);
  expect(isRecord({})).toBe(true);
  expect(isRecord(null)).toBe(false);
  expect(isRecord(undefined)).toBe(false);
  expect(isRecord([])).toBe(false);
  expect(isRecord('text')).toBe(false);
  expect(isRecord(1)).toBe(false);
});
