import { describe, expect, it } from 'bun:test';

import {
  buildAddPhotosA11yLabel,
  buildCloseViewerA11yLabel,
  buildCoverBadgeA11yLabel,
  buildMovePhotoDownA11yLabel,
  buildMovePhotoUpA11yLabel,
  buildPhotoCounterA11yLabel,
  buildRemovePhotoA11yLabel,
} from './imageGridA11y';

const fakeT = (key: string, options?: Record<string, unknown>): string => {
  const map: Record<string, string> = {
    'a11y.addPhotos': 'Add photos',
    'a11y.closeViewer': 'Close viewer',
    'a11y.coverBadge': 'Cover photo',
  };

  if (key === 'a11y.photoCounter') {
    return `Photo ${options?.current ?? 0} of ${options?.total ?? 0}`;
  }

  if (key === 'a11y.removePhoto') {
    return `Remove photo ${options?.index ?? 0}`;
  }

  if (key === 'a11y.movePhotoUp') {
    return `Move photo ${options?.index ?? 0} up`;
  }

  if (key === 'a11y.movePhotoDown') {
    return `Move photo ${options?.index ?? 0} down`;
  }

  return map[key] ?? key;
};

describe('buildPhotoCounterA11yLabel', () => {
  it('describes the first photo', () => {
    expect(buildPhotoCounterA11yLabel(1, 3, fakeT)).toBe('Photo 1 of 3');
  });

  it('describes a later photo', () => {
    expect(buildPhotoCounterA11yLabel(3, 5, fakeT)).toBe('Photo 3 of 5');
  });
});

describe('buildRemovePhotoA11yLabel', () => {
  it('uses one-based index for the remove action', () => {
    expect(buildRemovePhotoA11yLabel(1, fakeT)).toBe('Remove photo 1');
  });

  it('handles larger indices', () => {
    expect(buildRemovePhotoA11yLabel(4, fakeT)).toBe('Remove photo 4');
  });
});

describe('buildCoverBadgeA11yLabel', () => {
  it('announces the cover badge', () => {
    expect(buildCoverBadgeA11yLabel(fakeT)).toBe('Cover photo');
  });
});

describe('buildAddPhotosA11yLabel', () => {
  it('announces the add-photos action', () => {
    expect(buildAddPhotosA11yLabel(fakeT)).toBe('Add photos');
  });
});

describe('buildCloseViewerA11yLabel', () => {
  it('announces the close-viewer action', () => {
    expect(buildCloseViewerA11yLabel(fakeT)).toBe('Close viewer');
  });
});

describe('buildMovePhotoUpA11yLabel', () => {
  it('announces moving a photo up', () => {
    expect(buildMovePhotoUpA11yLabel(2, fakeT)).toBe('Move photo 2 up');
  });
});

describe('buildMovePhotoDownA11yLabel', () => {
  it('announces moving a photo down', () => {
    expect(buildMovePhotoDownA11yLabel(3, fakeT)).toBe('Move photo 3 down');
  });
});
