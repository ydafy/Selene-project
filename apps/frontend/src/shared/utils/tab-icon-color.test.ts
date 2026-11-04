import { describe, expect, it } from 'bun:test';

import { tabIconColor } from './tab-icon-color';

describe('tabIconColor', () => {
  it('passes string colors through', () => {
    expect(tabIconColor('#0A84FF')).toBe('#0A84FF');
  });

  it('drops values vector icons cannot take', () => {
    expect(tabIconColor(null)).toBeUndefined();
    expect(tabIconColor(0xff0000ff)).toBeUndefined();
  });
});
