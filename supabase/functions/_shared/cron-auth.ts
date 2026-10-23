// Cron callers prove themselves with the shared CRON_SECRET in `x-cron-secret`; the gateway JWT
// (public anon key) is not an identity. Fails closed when the secret is not configured.
export function isAuthorizedCronRequest(
  req: Request,
  expected: string | undefined,
): boolean {
  if (!expected) return false;

  const providedBytes = new TextEncoder().encode(
    req.headers.get('x-cron-secret') ?? '',
  );
  const expectedBytes = new TextEncoder().encode(expected);
  let difference = providedBytes.length ^ expectedBytes.length;
  const length = Math.max(providedBytes.length, expectedBytes.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (providedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return difference === 0;
}
