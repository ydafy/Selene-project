import { describe, expect, it } from 'bun:test';

import { reorderImages } from './imageReorder';

describe('reorderImages', () => {
  it('moves an image up', () => {
    expect(reorderImages(['a', 'b', 'c'], 1, 'up')).toEqual(['b', 'a', 'c']);
  });

  it('moves an image down', () => {
    expect(reorderImages(['a', 'b', 'c'], 0, 'down')).toEqual(['b', 'a', 'c']);
  });

  it('does not move the first image up', () => {
    expect(reorderImages(['a', 'b', 'c'], 0, 'up')).toEqual(['a', 'b', 'c']);
  });

  it('does not move the last image down', () => {
    expect(reorderImages(['a', 'b', 'c'], 2, 'down')).toEqual(['a', 'b', 'c']);
  });

  it('returns a new array reference', () => {
    const original = ['a', 'b', 'c'];
    const result = reorderImages(original, 0, 'down');

    expect(result).not.toBe(original);
  });
});
