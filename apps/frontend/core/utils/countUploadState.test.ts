import { describe, expect, it } from 'bun:test';

import { countUploadState } from './countUploadState';
import type { ImageUploadState } from './publishGuard';

describe('countUploadState', () => {
  it('counts completed images against the total', () => {
    const progress: Record<string, ImageUploadState> = {
      'a.jpg': { status: 'done', progress: 100 },
      'b.jpg': { status: 'uploading', progress: 0 },
      'c.jpg': { status: 'pending', progress: 0 },
    };

    expect(countUploadState(progress, ['a.jpg', 'b.jpg', 'c.jpg'])).toEqual({
      completed: 1,
      total: 3,
    });
  });

  it('treats missing entries as not completed', () => {
    const progress: Record<string, ImageUploadState> = {
      'a.jpg': { status: 'done', progress: 100 },
    };

    expect(countUploadState(progress, ['a.jpg', 'b.jpg'])).toEqual({
      completed: 1,
      total: 2,
    });
  });

  it('returns zero totals when no images are provided', () => {
    expect(countUploadState({}, [])).toEqual({ completed: 0, total: 0 });
  });

  it('reports all completed when every image is done', () => {
    const progress: Record<string, ImageUploadState> = {
      'a.jpg': { status: 'done', progress: 100 },
      'b.jpg': { status: 'done', progress: 100 },
    };

    expect(countUploadState(progress, ['a.jpg', 'b.jpg'])).toEqual({
      completed: 2,
      total: 2,
    });
  });
});
