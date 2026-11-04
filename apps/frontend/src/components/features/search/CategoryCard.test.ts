import { describe, expect, it } from 'bun:test';

import { buildCategoryCardA11yProps } from './categoryA11y';

describe('buildCategoryCardA11yProps', () => {
  it('returns a button role with the category label', () => {
    const props = buildCategoryCardA11yProps('GPU');

    expect(props.accessibilityRole).toBe('button');
    expect(props.accessibilityLabel).toBe('GPU');
  });

  it('preserves arbitrary category labels', () => {
    const props = buildCategoryCardA11yProps('Motherboard');

    expect(props.accessibilityLabel).toBe('Motherboard');
  });
});
