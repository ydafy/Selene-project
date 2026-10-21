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
      message: typeof e.message === 'string' ? e.message : undefined,
      code: e.code,
      status: e.status ?? e.statusCode,
    };
  }
  return { message: String(error) };
}
