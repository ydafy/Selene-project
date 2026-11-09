import { resolveMediaType } from '@/shared/lib/upload-media';

/**
 * Storage target for one verification proof. Every upload gets a fresh path in
 * the product folder (`<product_id>/<prefix>_<timestamp>.<ext>`), so a stored
 * proof is never overwritten; the bucket has no UPDATE policy either.
 */
export const buildVerificationProofUpload = (
  productId: string | undefined,
  prefix: string,
  uri: string,
  now: number,
) => {
  const { ext, contentType } = resolveMediaType(uri);
  return {
    bucket: 'verification' as const,
    path: `${productId}/${prefix}_${now}.${ext}`,
    contentType,
    upsert: false,
  };
};
