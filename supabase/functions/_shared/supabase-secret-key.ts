// The privileged Supabase key for server clients: the `default` secret key that the runtime injects
// in SUPABASE_SECRET_KEYS as JSON keyed by name (#398). It replaces the legacy service_role JWT.
// A secret key is not a JWT: use it through supabase-js (the API gateway accepts how it sends the key),
// and never hand-build a request that sends it as `Authorization: Bearer` to an Edge Function.
// Fails closed: anything but a well-formed `sb_secret_` key returns undefined, so the caller answers
// its usual server configuration error. Never logs the variable or the key.
const SECRET_KEY_PREFIX = 'sb_secret_';

export function readSupabaseSecretKey(
  getEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
): string | undefined {
  const raw = getEnv('SUPABASE_SECRET_KEYS');
  if (!raw) return undefined;

  let keys: unknown;
  try {
    keys = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) {
    return undefined;
  }

  const key = (keys as Record<string, unknown>).default;
  return typeof key === 'string' &&
    key.startsWith(SECRET_KEY_PREFIX) &&
    key.length > SECRET_KEY_PREFIX.length
    ? key
    : undefined;
}
