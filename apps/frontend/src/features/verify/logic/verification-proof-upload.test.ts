import { describe, expect, test } from 'bun:test';

import { buildVerificationProofUpload } from './verification-proof-upload';

describe('buildVerificationProofUpload', () => {
  test('targets a fresh path in the product folder and never overwrites', () => {
    expect(
      buildVerificationProofUpload(
        'product-1',
        'physical',
        'file:///photo.jpg',
        1700000000000,
      ),
    ).toEqual({
      bucket: 'verification',
      path: 'product-1/physical_1700000000000.jpg',
      contentType: 'image/jpeg',
      upsert: false,
    });
  });

  test('keeps the extension and type of a video proof', () => {
    const upload = buildVerificationProofUpload(
      'product-1',
      'bench',
      'file:///clip.mp4',
      1700000000001,
    );
    expect(upload.path).toBe('product-1/bench_1700000000001.mp4');
    expect(upload.contentType).toBe('video/mp4');
    expect(upload.upsert).toBe(false);
  });
});
