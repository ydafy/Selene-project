import { expect, mock, test } from 'bun:test';
import React from 'react';
// @ts-expect-error The installed test renderer has no declarations.
import { act, create } from 'react-test-renderer';

if (process.env.SELENE_UPLOAD_CHILD !== '1') {
  test('real upload hook preserves contracts with sanitized diagnostics', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_UPLOAD_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const privateError = new Error('SYNTHETIC_PRIVATE_UPLOAD_MARKER');
  let fail = true;
  let release!: () => void;
  const upload = mock(async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    return { error: fail ? privateError : null };
  });
  const getPublicUrl = mock(() => ({ data: { publicUrl: 'https://example.test/photo' } }));
  const from = mock(() => ({ upload, getPublicUrl }));
  const decode = mock(() => new ArrayBuffer(2));
  mock.module('react-native', () => ({ Alert: { alert: mock(() => {}) } }));
  mock.module('expo-image-picker', () => ({
    useMediaLibraryPermissions: () => [{ granted: true }, mock(() => {})],
    useCameraPermissions: () => [{ granted: true }, mock(() => {})],
  }));
  mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
  mock.module('base64-arraybuffer', () => ({ decode }));
  mock.module('../../core/db/supabase', () => ({ supabase: { storage: { from } } }));
  const { useImageUpload } = await import('../../core/hooks/useImageUpload');
  test('failure rethrows original identity without private logs; success preserves upload and cleanup', async () => {
    let api!: ReturnType<typeof useImageUpload>;
    function Probe() { api = useImageUpload(); return null; }
    let tree: ReturnType<typeof create>;
    const logs: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logs.push(args); };
    try {
      await act(async () => { tree = create(<Probe />); });
      let pending!: Promise<unknown>;
      await act(async () => { pending = api.uploadFile('evidence', 'shipments/order/user/photo.jpg', 'encoded', 'jpg').catch((error) => error); });
      expect(api.uploading).toBe(true);
      let caught: unknown;
      await act(async () => { release(); caught = await pending; });
      expect(caught).toBe(privateError);
      expect(api.uploading).toBe(false);
      expect(getPublicUrl).not.toHaveBeenCalled();
      expect(JSON.stringify(logs)).not.toContain('SYNTHETIC_PRIVATE_UPLOAD_MARKER');
      expect(logs.filter((args) => args[0] === '[IMAGE_UPLOAD]')).toEqual([['[IMAGE_UPLOAD]', { event: 'upload_failed' }]]);
      fail = false;
      let result: unknown;
      await act(async () => { pending = api.uploadFile('Avatars', 'avatar.jpg', 'encoded', 'png'); });
      expect(api.uploading).toBe(true);
      await act(async () => { release(); result = await pending; });
      expect(api.uploading).toBe(false);
      expect(result).toMatch(/^https:\/\/example.test\/photo\?t=\d+$/);
      expect(from.mock.calls).toEqual([['evidence'], ['Avatars'], ['Avatars']]);
      expect(upload.mock.calls[1]).toEqual(['avatar.jpg', expect.any(ArrayBuffer), { contentType: 'image/png', upsert: true }]);
      expect(getPublicUrl.mock.calls).toEqual([['avatar.jpg']]);
    } finally {
      await act(async () => { tree?.unmount(); });
      console.error = original;
    }
  });
}
