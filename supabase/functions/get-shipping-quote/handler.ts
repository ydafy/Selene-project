import type { SupabaseClient } from '../_shared/supabase-js.ts';
import { QuoteContractError, quoteListingShipment } from './quote-contract.ts';
import { ShippingQuoteRequestSchema } from './request-schema.ts';
import { resolveProductionQuoteRuntime } from './runtime.ts';

/**
 * Authenticates the caller before any quote work. The function runs with verify_jwt = false
 * (#399), so a missing or non-bearer header, an invalid token, or the anon key stops here with
 * 401 AUTH_REQUIRED, before the body is read and before any database or Envia call.
 */
export interface GetShippingQuoteDependencies {
  /** The signed-in user behind an access token, or null when the token is not a user session. */
  getUser: (accessToken: string) => Promise<{ id: string } | null>;
  quote: (req: Request) => Promise<Response>;
}

const bearerToken = (req: Request): string | null => {
  const match = /^Bearer\s+(\S+)$/i.exec(
    req.headers.get('Authorization') ?? '',
  );
  return match?.[1] ?? null;
};

export function createGetShippingQuoteHandler(
  deps: GetShippingQuoteDependencies,
) {
  return async (req: Request): Promise<Response> => {
    const token = bearerToken(req);
    const user = token ? await deps.getUser(token) : null;
    if (!user) {
      return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return deps.quote(req);
  };
}

export interface ShippingQuoteDependencies {
  /** Reads a server secret or setting; called on every request. */
  getEnv: (name: string) => string | undefined;
  /** The `default` Supabase secret key (`_shared/supabase-secret-key.ts`); called on every request. */
  readSupabaseSecretKey: () => string | undefined;
  /** Called after the body and the server configuration are valid. */
  createSupabaseAdmin: (
    supabaseUrl: string,
    supabaseSecretKey: string,
  ) => SupabaseClient;
  /** The HTTP client for the Envia rate request. */
  fetch: typeof globalThis.fetch;
}

const log = (level: string, message: string, meta?: unknown) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'get-shipping-quote',
      level,
      message,
      ...((meta as Record<string, unknown>) || {}),
    }),
  );
};

export function createShippingQuote(deps: ShippingQuoteDependencies) {
  return async (req: Request): Promise<Response> => {
    try {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw new Error('INVALID_INPUT');
      }
      const result = ShippingQuoteRequestSchema.safeParse(body);
      if (!result.success) {
        log('error', 'INVALID_INPUT');
        throw new Error('INVALID_INPUT');
      }

      const runtimeConfiguration = resolveProductionQuoteRuntime((name) =>
        deps.getEnv(name),
      );
      const supabaseSecretKey = deps.readSupabaseSecretKey();
      const supabaseUrl = deps.getEnv('SUPABASE_URL');
      if (!runtimeConfiguration || !supabaseSecretKey || !supabaseUrl) {
        throw new Error('MISSING_SERVER_CONFIG');
      }

      const { originZip, packageId, price, destinationZip } = result.data;
      const destZip = destinationZip || '06500';

      const supabaseAdmin = deps.createSupabaseAdmin(
        supabaseUrl,
        supabaseSecretKey,
      );
      let sys: { package_presets: unknown } | null = null;
      try {
        const { data, error: systemSettingsError } = await supabaseAdmin
          .from('system_settings')
          .select('package_presets')
          .eq('id', 1)
          .single();
        if (systemSettingsError || !data) {
          throw new Error('SYSTEM_CONFIG_NOT_FOUND');
        }
        sys = data;
      } catch {
        throw new Error('SYSTEM_CONFIG_NOT_FOUND');
      }

      if (!sys.package_presets) {
        throw new Error('SYSTEM_CONFIG_NOT_FOUND');
      }

      const { rates } = await quoteListingShipment({
        requestedPackageId: packageId,
        packagePresets: sys.package_presets,
        originZip,
        destinationZip: destZip,
        price,
        runtimeMode: runtimeConfiguration.mode,
        apiUrl: runtimeConfiguration.apiUrl,
        apiKey: runtimeConfiguration.apiKey,
        fetch: deps.fetch,
        log: (event) => log('info', String(event.event), event),
      });

      return new Response(JSON.stringify({ rates }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: unknown) {
      const code =
        err instanceof QuoteContractError
          ? err.code
          : err instanceof Error &&
              [
                'INVALID_INPUT',
                'MISSING_SERVER_CONFIG',
                'SYSTEM_CONFIG_NOT_FOUND',
              ].includes(err.message)
            ? err.message
            : 'PROVIDER_NETWORK_ERROR';
      const status =
        code === 'INVALID_INPUT' ||
        code === 'UNKNOWN_PACKAGE_PRESET' ||
        code === 'INVALID_PACKAGE_PRESET'
          ? 422
          : code === 'PROVIDER_TIMEOUT'
            ? 504
            : code.startsWith('PROVIDER_')
              ? 502
              : 500;
      log('error', code);
      return new Response(JSON.stringify({ error: code }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}
