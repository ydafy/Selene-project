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

export type CronMismatchReporter = (
  message: string,
  options: { fingerprint: string[]; tags: Record<string, string> },
) => void | Promise<void>;

// A request that sends a wrong x-cron-secret is a misconfigured job (the Vault copy drifted);
// a request without the header is an ordinary probe and stays silent. Never reports the header
// value, and a failing reporter never changes the 401 the caller returns.
export async function reportCronSecretMismatch(
  req: Request,
  functionName: string,
  report: CronMismatchReporter,
): Promise<void> {
  if (!req.headers.get('x-cron-secret')) return;
  try {
    await report(`${functionName} cron secret mismatch`, {
      fingerprint: ['cron-secret-mismatch', functionName],
      tags: { edge_function: functionName },
    });
  } catch {
    // Alerting is best effort.
  }
}
