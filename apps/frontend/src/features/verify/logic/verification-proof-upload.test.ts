import { describe, expect, test } from 'bun:test';

import {
  buildVerificationProofUpload,
  VERIFICATION_PROOF_MAX_BYTES,
} from './verification-proof-upload';

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
      maxBytes: VERIFICATION_PROOF_MAX_BYTES,
    });
  });

  test('limits a proof to the 10 MiB the verification bucket accepts', () => {
    expect(VERIFICATION_PROOF_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  test('rejects a video proof, which the verification bucket refuses', () => {
    expect(() =>
      buildVerificationProofUpload(
        'product-1',
        'bench',
        'file:///clip.mp4',
        1700000000001,
      ),
    ).toThrow('MEDIA_TYPE_UNSUPPORTED');
  });
});
