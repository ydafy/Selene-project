export type ReorderDirection = 'left' | 'right';

/**
 * Reorders an image array by moving the item at `fromIndex` one position
 * in the requested direction. Returns a new array; the original is untouched.
 */
export const reorderImages = (
  images: string[],
  fromIndex: number,
  direction: ReorderDirection,
): string[] => {
  const toIndex = direction === 'left' ? fromIndex - 1 : fromIndex + 1;

  if (toIndex < 0 || toIndex >= images.length) {
    return images;
  }

  const next = [...images];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};
