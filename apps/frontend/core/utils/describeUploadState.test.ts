import { describe, expect, it } from 'bun:test';

import { describeUploadState } from './describeUploadState';
import type { ImageUploadState } from './publishGuard';

describe('describeUploadState', () => {
  it('describes a pending image', () => {
    const state: ImageUploadState = { status: 'pending', progress: 0 };

    expect(describeUploadState(state)).toEqual({
      labelKey: 'sell:preview.imagePending',
      progress: undefined,
    });
  });

  it('describes an uploading image without a percentage', () => {
    const state: ImageUploadState = { status: 'uploading', progress: 42 };

    expect(describeUploadState(state)).toEqual({
      labelKey: 'sell:preview.imageUploading',
      progress: undefined,
    });
  });

  it('describes a completed image', () => {
    const state: ImageUploadState = { status: 'done', progress: 100 };

    expect(describeUploadState(state)).toEqual({
      labelKey: 'sell:preview.imageDone',
      progress: undefined,
    });
  });

  it('describes an errored image', () => {
    const state: ImageUploadState = { status: 'error', progress: 0 };

    expect(describeUploadState(state)).toEqual({
      labelKey: 'sell:preview.imageError',
      progress: undefined,
    });
  });

  it('treats a missing state as pending', () => {
    expect(describeUploadState(undefined)).toEqual({
      labelKey: 'sell:preview.imagePending',
      progress: undefined,
    });
  });
});
