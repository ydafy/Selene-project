/**
 * @file supabase/functions/_shared/cors.ts
 *
 * The only CORS policy of the Edge Functions. A function serves with `serveAdminWeb` instead of
 * `Deno.serve` only when the admin-web calls it from the browser; native apps, cron jobs and webhooks are not subject
 * to CORS and get no CORS headers. The allowed origins come from `ADMIN_WEB_ORIGINS`, a
 * comma-separated list of exact origins (`https://admin.example,http://127.0.0.1:5188`).
 * A missing, blank or invalid list allows no origin. CORS only tells the browser whether the
 * page may read the response; each function still authenticates and authorizes the caller.
 */

// The headers the pinned supabase-js client may send (its `@supabase/supabase-js/cors` export);
// cors.test.ts fails when a supabase-js bump changes them.
const ALLOWED_HEADERS =
  'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage';
const ALLOWED_METHODS = 'GET, POST, OPTIONS';

type Handler = (req: Request) => Response | Promise<Response>;

/** Exact origins only: `*`, `null`, paths, trailing slashes and other spellings are dropped. */
export function parseAllowedOrigins(value: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const entry of (value ?? '').split(',')) {
    const candidate = entry.trim();
    if (!candidate) continue;
    try {
      if (new URL(candidate).origin === candidate) origins.add(candidate);
    } catch {
      // Not a URL: never an allowed origin.
    }
  }
  return origins;
}

export function createAdminWebCors(
  getAllowedOrigins: () => string | undefined,
) {
  return (handler: Handler): Handler =>
    async (req) => {
      const origin = req.headers.get('Origin');
      const allowedOrigin =
        origin !== null && parseAllowedOrigins(getAllowedOrigins()).has(origin)
          ? origin
          : null;

      if (req.method === 'OPTIONS') {
        const headers = new Headers({ Vary: 'Origin' });
        if (allowedOrigin) {
          headers.set('Access-Control-Allow-Origin', allowedOrigin);
          headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
          headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
        }
        return new Response(null, { status: 204, headers });
      }

      const response = await handler(req);
      const headers = new Headers(response.headers);
      headers.append('Vary', 'Origin');
      if (allowedOrigin)
        headers.set('Access-Control-Allow-Origin', allowedOrigin);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };
}

const withAdminWebCors = createAdminWebCors(() =>
  Deno.env.get('ADMIN_WEB_ORIGINS'),
);

/** `Deno.serve` for a function the admin-web calls from the browser. */
export const serveAdminWeb = (handler: Handler) =>
  Deno.serve(withAdminWebCors(handler));
