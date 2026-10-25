import { describe, expect, test } from 'bun:test';
import { getOrderStatusColor } from '../order-status';

describe('getOrderStatusColor', () => {
  test('pending orders use the pending state color', () => {
    expect(getOrderStatusColor('pending')).toBe('pending');
  });

  test('other states keep their colors', () => {
    expect(getOrderStatusColor('paid')).toBe('paid');
    expect(getOrderStatusColor('completed')).toBe('completed');
    expect(getOrderStatusColor('dispute')).toBe('error');
  });
});
