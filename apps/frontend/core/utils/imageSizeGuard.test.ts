import { describe, expect, it } from 'bun:test';

import {
  formatMaxImageSizeMB,
  isImageTooLarge,
  MAX_IMAGE_SIZE_BYTES,
} from './imageSizeGuard';

describe('MAX_IMAGE_SIZE_BYTES', () => {
  it('equals 8 MB', () => {
    expect(MAX_IMAGE_SIZE_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe('isImageTooLarge', () => {
  it('returns false for an 8 MB photo', () => {
    expect(isImageTooLarge(8 * 1024 * 1024)).toBe(false);
  });

  it('returns true for a photo just over 8 MB', () => {
    expect(isImageTooLarge(8 * 1024 * 1024 + 1)).toBe(true);
  });

  it('returns false when fileSize is missing', () => {
    expect(isImageTooLarge(undefined)).toBe(false);
    expect(isImageTooLarge(null)).toBe(false);
  });
});

describe('formatMaxImageSizeMB', () => {
  it('returns 8', () => {
    expect(formatMaxImageSizeMB()).toBe('8');
  });
});
