import { describeError } from '../utils/describe-error';

const MEDIA_TYPES: Record<string, { ext: string; contentType: string }> = {
  jpg: { ext: 'jpg', contentType: 'image/jpeg' },
  jpeg: { ext: 'jpg', contentType: 'image/jpeg' },
  png: { ext: 'png', contentType: 'image/png' },
  webp: { ext: 'webp', contentType: 'image/webp' },
  heic: { ext: 'heic', contentType: 'image/heic' },
  heif: { ext: 'heif', contentType: 'image/heif' },
  mp4: { ext: 'mp4', contentType: 'video/mp4' },
  // iOS pickers can return QuickTime containers instead of MP4.
  mov: { ext: 'mov', contentType: 'video/quicktime' },
  m4v: { ext: 'm4v', contentType: 'video/x-m4v' },
};

/** Resolves the storage extension and MIME type from a URI; never guesses. */
export function resolveMediaType(uri: string): {
  ext: string;
  contentType: string;
} {
  const clean = uri.split(/[?#]/)[0];
  const lastSegment = clean.split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  const raw = dot >= 0 ? lastSegment.slice(dot + 1).toLowerCase() : '';
  const type = Object.prototype.hasOwnProperty.call(MEDIA_TYPES, raw)
    ? MEDIA_TYPES[raw]
    : undefined;
  if (!type) throw new Error('MEDIA_TYPE_UNSUPPORTED');
  return { ...type };
}

export interface MediaStorage {
  from(bucket: string): {
    upload(
      path: string,
      body: ArrayBuffer,
      options: { contentType: string; upsert: boolean },
    ): Promise<{ data: { path: string } | null; error: unknown }>;
  };
}

/** Reads a local/remote URI and uploads it; returns the stored path. */
export async function uploadMediaFromUri({
  storage,
  bucket,
  path,
  uri,
  contentType,
  upsert,
  maxBytes,
  fetchImpl = fetch,
}: {
  storage: MediaStorage;
  bucket: string;
  path: string;
  uri: string;
  contentType: string;
  upsert: boolean;
  /** Rejects bodies larger than this many bytes before uploading. */
  maxBytes?: number;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  try {
    const response = await fetchImpl(uri);
    if (!response.ok) throw new Error('MEDIA_READ_FAILED');

    const body = await response.arrayBuffer();
    if (body.byteLength === 0) throw new Error('MEDIA_EMPTY');
    if (maxBytes !== undefined && body.byteLength > maxBytes)
      throw new Error('MEDIA_TOO_LARGE');

    const { data, error } = await storage
      .from(bucket)
      .upload(path, body, { contentType, upsert });
    if (error) throw error;
    if (!data?.path) throw new Error('MEDIA_UPLOAD_NO_PATH');
    return data.path;
  } catch (error) {
    console.error('[media] upload failed', { bucket, ...describeError(error) });
    throw error;
  }
}

/** Decodes a base64 payload with the injected decoder and uploads it; returns the stored path. */
export async function uploadMediaFromBase64({
  storage,
  bucket,
  path,
  base64,
  contentType,
  upsert,
  decode,
}: {
  storage: MediaStorage;
  bucket: string;
  path: string;
  base64: string | null | undefined;
  contentType: string;
  upsert: boolean;
  decode: (base64: string) => ArrayBuffer;
}): Promise<string> {
  try {
    if (!base64) throw new Error('MEDIA_EMPTY');

    const body = decode(base64);
    if (body.byteLength === 0) throw new Error('MEDIA_EMPTY');

    const { data, error } = await storage
      .from(bucket)
      .upload(path, body, { contentType, upsert });
    if (error) throw error;
    if (!data?.path) throw new Error('MEDIA_UPLOAD_NO_PATH');
    return data.path;
  } catch (error) {
    console.error('[media] upload failed', { bucket, ...describeError(error) });
    throw error;
  }
}
