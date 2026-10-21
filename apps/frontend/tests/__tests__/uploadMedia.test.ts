import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveMediaType,
  uploadMediaFromUri,
} from '../../core/storage/uploadMedia';

const FRONTEND = join(import.meta.dir, '..', '..');

type UploadResult = { data: { path: string } | null; error: unknown };

function makeStorage(result: UploadResult) {
  const calls: unknown[][] = [];
  const storage = {
    from: (bucket: string) => ({
      upload: async (...args: unknown[]) => {
        calls.push([bucket, ...args]);
        return result;
      },
    }),
  };
  return { storage, calls };
}

function makeFetch(ok: boolean, bytes: number) {
  return (async () => ({
    ok,
    arrayBuffer: async () => new ArrayBuffer(bytes),
  })) as unknown as typeof fetch;
}

describe('resolveMediaType', () => {
  it('maps jpeg and jpg to image/jpeg with ext jpg', () => {
    expect(resolveMediaType('file:///a/b.jpeg')).toEqual({
      ext: 'jpg',
      contentType: 'image/jpeg',
    });
    expect(resolveMediaType('file:///a/b.jpg')).toEqual({
      ext: 'jpg',
      contentType: 'image/jpeg',
    });
  });

  it('maps the other supported extensions', () => {
    expect(resolveMediaType('x.png').contentType).toBe('image/png');
    expect(resolveMediaType('x.webp').contentType).toBe('image/webp');
    expect(resolveMediaType('x.heic').contentType).toBe('image/heic');
    expect(resolveMediaType('x.heif').contentType).toBe('image/heif');
    expect(resolveMediaType('x.mp4')).toEqual({
      ext: 'mp4',
      contentType: 'video/mp4',
    });
  });

  it('handles uppercase extensions and query/fragment suffixes', () => {
    expect(resolveMediaType('file:///a/B.PNG')).toEqual({
      ext: 'png',
      contentType: 'image/png',
    });
    expect(resolveMediaType('https://h/p/a.JPEG?token=1.gif#frag.bmp')).toEqual(
      { ext: 'jpg', contentType: 'image/jpeg' },
    );
  });

  it('throws MEDIA_TYPE_UNSUPPORTED for unknown or missing extensions', () => {
    expect(() => resolveMediaType('file:///a/b.gif')).toThrow(
      'MEDIA_TYPE_UNSUPPORTED',
    );
    expect(() => resolveMediaType('file:///a/noext')).toThrow(
      'MEDIA_TYPE_UNSUPPORTED',
    );
    expect(() => resolveMediaType('')).toThrow('MEDIA_TYPE_UNSUPPORTED');
  });
});

describe('uploadMediaFromUri', () => {
  let errorSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  const base = {
    bucket: 'products',
    path: 'user-1/secret-name.jpg',
    uri: 'file:///private/photo.jpg',
    contentType: 'image/jpeg',
    upsert: false,
  };

  it('throws MEDIA_READ_FAILED on a non-ok read and never uploads', async () => {
    const { storage, calls } = makeStorage({ data: { path: 'p' }, error: null });
    await expect(
      uploadMediaFromUri({ ...base, storage, fetchImpl: makeFetch(false, 5) }),
    ).rejects.toThrow('MEDIA_READ_FAILED');
    expect(calls).toHaveLength(0);
  });

  it('throws MEDIA_EMPTY on an empty body and never uploads', async () => {
    const { storage, calls } = makeStorage({ data: { path: 'p' }, error: null });
    await expect(
      uploadMediaFromUri({ ...base, storage, fetchImpl: makeFetch(true, 0) }),
    ).rejects.toThrow('MEDIA_EMPTY');
    expect(calls).toHaveLength(0);
  });

  it('rethrows the storage error', async () => {
    const storageError = new Error('bucket exploded');
    const { storage } = makeStorage({ data: null, error: storageError });
    await expect(
      uploadMediaFromUri({ ...base, storage, fetchImpl: makeFetch(true, 4) }),
    ).rejects.toBe(storageError);
  });

  it('throws MEDIA_UPLOAD_NO_PATH when storage returns no path', async () => {
    const { storage } = makeStorage({ data: null, error: null });
    await expect(
      uploadMediaFromUri({ ...base, storage, fetchImpl: makeFetch(true, 4) }),
    ).rejects.toThrow('MEDIA_UPLOAD_NO_PATH');
  });

  it('uploads with the exact path, contentType and upsert and returns data.path', async () => {
    const { storage, calls } = makeStorage({
      data: { path: 'stored/path.jpg' },
      error: null,
    });
    const result = await uploadMediaFromUri({
      ...base,
      upsert: true,
      storage,
      fetchImpl: makeFetch(true, 4),
    });
    expect(result).toBe('stored/path.jpg');
    expect(calls).toHaveLength(1);
    const [bucket, path, body, options] = calls[0];
    expect(bucket).toBe('products');
    expect(path).toBe(base.path);
    expect((body as ArrayBuffer).byteLength).toBe(4);
    expect(options).toEqual({ contentType: 'image/jpeg', upsert: true });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs once with the bucket but never the uri or path', async () => {
    const { storage } = makeStorage({
      data: null,
      error: new Error('boom'),
    });
    await expect(
      uploadMediaFromUri({ ...base, storage, fetchImpl: makeFetch(true, 4) }),
    ).rejects.toThrow('boom');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [label, payload] = errorSpy.mock.calls[0];
    expect(label).toBe('[media] upload failed');
    expect((payload as { bucket: string }).bucket).toBe('products');
    const serialized = JSON.stringify(errorSpy.mock.calls[0]);
    expect(serialized).not.toContain(base.uri);
    expect(serialized).not.toContain(base.path);
  });
});

describe('upload call sites', () => {
  const hooks = ['core/hooks/usePublishProduct.ts', 'core/hooks/useVerificationLogic.ts'];
  for (const file of hooks) {
    it(`${file} uses the shared helper`, () => {
      const source = readFileSync(join(FRONTEND, file), 'utf8');
      expect(source).toContain('uploadMediaFromUri');
      expect(source).not.toContain('contentType: `image/${');
      expect(source).not.toContain('await fetch(uri)');
    });
  }
});
