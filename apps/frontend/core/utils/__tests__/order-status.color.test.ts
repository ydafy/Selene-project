import { describe, expect, test } from 'bun:test';
import { OrderStatus } from '@selene/types';
import { getOrderStatusColor, getOrderStatusTextColor } from '../order-status';

const ALL_STATES: OrderStatus[] = [
  'pending',
  'paid',
  'preparing',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
  'refunded',
  'dispute',
];

describe('getOrderStatusColor', () => {
  test('every state uses its own state color', () => {
    for (const status of ALL_STATES) {
      expect(getOrderStatusColor(status)).toBe(status);
    }
  });
});

describe('getOrderStatusTextColor', () => {
  test('dark closing states use legible primary text', () => {
    expect(getOrderStatusTextColor('cancelled')).toBe('textPrimary');
    expect(getOrderStatusTextColor('refunded')).toBe('textPrimary');
    expect(getOrderStatusTextColor('dispute')).toBe('textPrimary');
  });

  test('other states keep their state color as text', () => {
    for (const status of ALL_STATES.filter(
      (s) => !['cancelled', 'refunded', 'dispute'].includes(s),
    )) {
      expect(getOrderStatusTextColor(status)).toBe(status);
    }
  });
});
