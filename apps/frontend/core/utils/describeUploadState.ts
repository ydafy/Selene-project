import type { ImageUploadState } from './publishGuard';

export type UploadStateDescription = {
  labelKey: string;
  progress?: number;
};

/**
 * Maps a per-image upload state to an i18n label key and optional progress value.
 * Keeps JSX free of status-branching logic.
 */
export const describeUploadState = (
  state: ImageUploadState | undefined,
): UploadStateDescription => {
  switch (state?.status) {
    case 'uploading':
      return { labelKey: 'sell:preview.imageUploading' };
    case 'done':
      return { labelKey: 'sell:preview.imageDone' };
    case 'error':
      return { labelKey: 'sell:preview.imageError' };
    case 'pending':
    default:
      return { labelKey: 'sell:preview.imagePending' };
  }
};
