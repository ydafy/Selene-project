/**
 * Sanitizes a beneficiary name for BBVA Net Cash SPEI dispersion files.
 *
 * Rules:
 * - UPPERCASE
 * - Strip accents: á→A, é→E, í→I, ó→O, ú→U, ü→U (and uppercase versions)
 * - Replace Ñ/ñ with N
 * - Remove special characters (anything not A-Z, 0-9, space)
 * - Collapse multiple spaces to single space
 * - Trim
 * - Null/undefined → empty string ""
 */
export function sanitizeBBVAName(name: string | null | undefined): string {
  if (name == null) {
    return '';
  }

  return (
    name
      // Uppercase first
      .toUpperCase()
      // Strip accents (NFC decomposition + remove combining marks)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Replace Ñ/ñ with N (normalize NFD makes ñ→ñ, so we handle both)
      .replace(/[Ññ]/g, 'N')
      // Remove special characters: keep only A-Z, 0-9, space
      .replace(/[^A-Z0-9\s]/g, ' ')
      // Collapse multiple spaces
      .replace(/\s+/g, ' ')
      // Trim
      .trim()
  );
}
