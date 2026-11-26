/**
 * Pure helpers for ImageGridPicker accessibility labels.
 *
 * Isolated in this file so the label-building logic can be unit-tested in Bun
 * without importing React Native through the component tree.
 */

// Two call shapes instead of one optional parameter: i18next 27 types TFunction
// as a union of argument tuples, and an optional `options` matches none of them.
export type ImageGridTranslator = {
  (key: string): string;
  (key: string, options: Record<string, unknown>): string;
};

export const buildPhotoCounterA11yLabel = (
  current: number,
  total: number,
  t: ImageGridTranslator,
): string => t('a11y.photoCounter', { current, total });

export const buildRemovePhotoA11yLabel = (
  index: number,
  t: ImageGridTranslator,
): string => t('a11y.removePhoto', { index });

export const buildCoverBadgeA11yLabel = (t: ImageGridTranslator): string =>
  t('a11y.coverBadge');

export const buildAddPhotosA11yLabel = (t: ImageGridTranslator): string =>
  t('a11y.addPhotos');

export const buildCloseViewerA11yLabel = (t: ImageGridTranslator): string =>
  t('a11y.closeViewer');

export const buildMovePhotoUpA11yLabel = (
  index: number,
  t: ImageGridTranslator,
): string => t('a11y.movePhotoUp', { index });

export const buildMovePhotoDownA11yLabel = (
  index: number,
  t: ImageGridTranslator,
): string => t('a11y.movePhotoDown', { index });
