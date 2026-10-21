// Only our own error codes (e.g. MEDIA_READ_FAILED) are safe to log as messages;
// provider and native messages are free text that may carry paths or user data.
const ERROR_CODE_PATTERN = /^(MEDIA|VERIFICATION|VIDEO)_[A-Z0-9_]+$/;

const safeMessage = (value: unknown) =>
  typeof value === 'string' && ERROR_CODE_PATTERN.test(value) ? value : undefined;

/** Error summary safe to log: no file paths, URIs, or user data. */
export function describeError(error: unknown) {
  if (error && typeof error === 'object') {
    const e = error as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
    };
    return {
      name: typeof e.name === 'string' ? e.name : undefined,
      message: safeMessage(e.message),
      code: e.code,
      status: e.status ?? e.statusCode,
    };
  }
  return { message: safeMessage(error) };
}
