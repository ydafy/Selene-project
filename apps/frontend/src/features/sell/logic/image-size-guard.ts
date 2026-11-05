export const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Returns true when the image exceeds the max allowed byte size.
 * Missing size is accepted because some URIs do not expose it.
 */
export const isImageTooLarge = (fileSize?: number | null): boolean => {
  if (fileSize == null) return false;
  return fileSize > MAX_IMAGE_SIZE_BYTES;
};

/**
 * Returns the max image size formatted as a whole MB string for UI copy.
 */
export const formatMaxImageSizeMB = (): string =>
  (MAX_IMAGE_SIZE_BYTES / 1024 / 1024).toString();
