import { describe, expect, it } from 'bun:test';

import { reorderImages } from './imageReorder';

describe('reorderImages', () => {
  it('moves an image left', () => {
    expect(reorderImages(['a', 'b', 'c'], 1, 'left')).toEqual(['b', 'a', 'c']);
  });

  it('moves an image right', () => {
    expect(reorderImages(['a', 'b', 'c'], 0, 'right')).toEqual(['b', 'a', 'c']);
  });

  it('does not move the first image left', () => {
    expect(reorderImages(['a', 'b', 'c'], 0, 'left')).toEqual(['a', 'b', 'c']);
  });

  it('does not move the last image right', () => {
    expect(reorderImages(['a', 'b', 'c'], 2, 'right')).toEqual(['a', 'b', 'c']);
  });

  it('returns a new array reference', () => {
    const original = ['a', 'b', 'c'];
    const result = reorderImages(original, 0, 'right');

    expect(result).not.toBe(original);
  });
});
