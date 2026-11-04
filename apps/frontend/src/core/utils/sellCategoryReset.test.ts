import { describe, expect, it } from 'bun:test';

import { getCategoryResetFields } from './sellCategoryReset';

describe('getCategoryResetFields', () => {
  it('resets condition, usage, and specifications', () => {
    const reset = getCategoryResetFields();

    expect(reset.condition).toBe('');
    expect(reset.usage).toBe('');
    expect(reset.specifications).toEqual({});
  });

  it('does not include unrelated fields', () => {
    const reset = getCategoryResetFields();

    expect('name' in reset).toBe(false);
    expect('price' in reset).toBe(false);
    expect('description' in reset).toBe(false);
    expect('images' in reset).toBe(false);
  });
});
