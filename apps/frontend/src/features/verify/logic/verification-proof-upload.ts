import { resolveMediaType } from '@/shared/lib/upload-media';

/** The `verification` bucket's size limit (migration 20261116015453). */
export const VERIFICATION_PROOF_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Storage target for one verification proof. Every upload gets a fresh path in
 * the product folder (`<product_id>/<prefix>_<timestamp>.<ext>`), so a stored
 * proof is never overwritten; the bucket has no UPDATE policy either. The
 * bucket only accepts photos up to 10 MiB, so a video or a larger file is
 * refused here (`MEDIA_TYPE_UNSUPPORTED`, `MEDIA_TOO_LARGE`) before uploading.
 */
export const buildVerificationProofUpload = (
  productId: string | undefined,
  prefix: string,
  uri: string,
  now: number,
) => {
  const { ext, contentType } = resolveMediaType(uri);
  if (!contentType.startsWith('image/')) {
    throw new Error('MEDIA_TYPE_UNSUPPORTED');
  }
  return {
    bucket: 'verification' as const,
    path: `${productId}/${prefix}_${now}.${ext}`,
    contentType,
    upsert: false,
    maxBytes: VERIFICATION_PROOF_MAX_BYTES,
  };
};
