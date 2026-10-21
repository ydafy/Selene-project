import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = join(import.meta.dir, '..', '..');
const read = (file: string) => readFileSync(join(FRONTEND, file), 'utf8');
const json = (locale: string) =>
  JSON.parse(read(`core/i18n/locales/${locale}/disputes.json`));

describe('media upload B3 source guards', () => {
  it('has no unchecked base64 assertions at the capture call sites', () => {
    expect(read('components/features/orders/EvidenceUploadSection.tsx')).not.toContain('base64!');
    expect(read('app/(tabs)/profile.tsx')).not.toContain('base64!');
  });

  it('uses the base64 helper and never image/jpg in useImageUpload', () => {
    const source = read('core/hooks/useImageUpload.ts');
    expect(source).toContain('uploadMediaFromBase64');
    expect(source).not.toContain('image/jpg');
    expect(source).not.toContain('[IMAGE_UPLOAD]');
  });

  it('EvidenceUploadSection logs failures through describeError', () => {
    const source = read('components/features/orders/EvidenceUploadSection.tsx');
    expect(source).toContain('describeError');
    expect(source).not.toContain("event: 'capture_or_upload_failed'");
  });

  it('useVideoUpload uses the shared helper, a submit guard and i18n', () => {
    const source = read('core/hooks/useVideoUpload.ts');
    expect(source).toContain('uploadMediaFromUri');
    expect(source).toContain('maxBytes');
    expect(source).toContain('useRef');
    expect(source).not.toContain('await fetch(uri)');
    for (const literal of [
      'Permiso denegado',
      'Necesitamos acceso a tus videos',
      'Video muy largo',
      'Archivo muy pesado',
      'No se pudo abrir el selector',
      'Faltan parámetros',
      "'Error'",
      'video/mp4',
    ]) {
      expect(source).not.toContain(literal);
    }
  });

  it('adds the video picker i18n keys in es and en', () => {
    const es = json('es').video;
    const en = json('en').video;
    expect(es).toEqual({
      permissionDeniedTitle: 'Permiso denegado',
      permissionDeniedMsg: 'Necesitamos acceso a tus videos.',
      tooLongTitle: 'Video muy largo',
      tooLongMsg: 'El video no debe superar los 2 minutos. Por favor, recórtalo.',
      tooLargeTitle: 'Archivo muy pesado',
      tooLargeMsg: 'El video supera los 50MB. Intenta grabar en una resolución menor.',
      pickerErrorTitle: 'Error',
      pickerErrorMsg: 'No se pudo abrir el selector de video.',
    });
    expect(en).toEqual({
      permissionDeniedTitle: 'Permission denied',
      permissionDeniedMsg: 'We need access to your videos.',
      tooLongTitle: 'Video too long',
      tooLongMsg: 'The video must not exceed 2 minutes. Please trim it.',
      tooLargeTitle: 'File too large',
      tooLargeMsg: 'The video exceeds 50MB. Try recording at a lower resolution.',
      pickerErrorTitle: 'Error',
      pickerErrorMsg: 'Could not open the video picker.',
    });
  });
});

describe('dispute video cross-platform and size feedback', () => {
  it('accepts iOS QuickTime and Android MP4 videos', async () => {
    const { resolveMediaType } = await import('../../core/storage/uploadMedia');
    expect(resolveMediaType('file:///var/mobile/IMG_0001.MOV')).toEqual({ ext: 'mov', contentType: 'video/quicktime' });
    expect(resolveMediaType('file:///data/user/0/video.mp4')).toEqual({ ext: 'mp4', contentType: 'video/mp4' });
    expect(resolveMediaType('file:///var/mobile/clip.m4v')).toEqual({ ext: 'm4v', contentType: 'video/x-m4v' });
  });

  it('shows the too-large message when the real file size exceeds the limit', () => {
    const screen = read('app/profile/orders/report/[id].tsx').replace(/\s+/g, ' ');
    expect(screen).toContain(
      "if (error instanceof Error && error.message === 'MEDIA_TOO_LARGE') { Alert.alert( t('disputes:video.tooLargeTitle'), t('disputes:video.tooLargeMsg'), ); return; }",
    );
  });

  it('logs the screen failure without the raw error object', () => {
    const screen = read('app/profile/orders/report/[id].tsx');
    expect(screen).not.toContain("console.error('[VIDEO_UPLOAD_ERROR]', error)");
    expect(screen).toContain("console.error('[VIDEO_UPLOAD_ERROR]', describeError(error))");
  });
});
