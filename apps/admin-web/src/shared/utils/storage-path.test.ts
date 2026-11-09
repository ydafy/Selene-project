import { describe, expect, it } from 'bun:test';
import { getStoragePath } from './storage-path';

describe('getStoragePath', () => {
  it('returns a plain object path unchanged', () => {
    expect(getStoragePath('disputes/order/user/slot_0.jpg', 'evidence')).toBe(
      'disputes/order/user/slot_0.jpg',
    );
  });

  it('extracts the object path from a storage URL of the bucket', () => {
    expect(
      getStoragePath(
        'https://project.supabase.co/storage/v1/object/public/evidence/shipments/order/user/slot_0.jpg',
        'evidence',
      ),
    ).toBe('shipments/order/user/slot_0.jpg');
  });

  it('returns an empty string for an empty input', () => {
    expect(getStoragePath('', 'evidence')).toBe('');
  });
});
