/** `value` as a plain object, or `null` for `null`, arrays, and primitives. */
export const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Whether `value` is a plain object: not `null`, not an array, not a primitive. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  asRecord(value) !== null;
