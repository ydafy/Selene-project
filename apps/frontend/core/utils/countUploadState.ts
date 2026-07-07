import type { ImageUploadState } from './publishGuard';

export type UploadCount = {
  completed: number;
  total: number;
};

/**
 * Computes a deterministic aggregate upload count from internal per-image states.
 * Because Supabase Storage `onUploadProgress` is not a proven option, we do not
 * rely on percentage callbacks; we only count images that have reached `done`.
 */
export const countUploadState = (
  progress: Record<string, ImageUploadState>,
  uris: string[],
): UploadCount => ({
  completed: uris.filter((uri) => progress[uri]?.status === 'done').length,
  total: uris.length,
});
