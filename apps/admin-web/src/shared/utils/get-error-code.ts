const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The stable server error code carried by a thrown error, if any. */
export function getErrorCode(error: unknown): string | null {
  const code = asRecord(error)?.code;
  return typeof code === 'string' ? code : null;
}
