import { createClient } from '../_shared/supabase-js.ts';
import { readSupabaseSecretKey } from '../_shared/supabase-secret-key.ts';
import { QuoteContractError, quoteListingShipment } from './quote-contract.ts';
import { ShippingQuoteRequestSchema } from './request-schema.ts';
import { resolveProductionQuoteRuntime } from './runtime.ts';
import { withSentry } from '../_shared/sentry.ts';
import { createGetShippingQuoteHandler } from './handler.ts';

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

const supabaseAuth = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  readSupabaseSecretKey() ?? '',
);

const quote = async (req: Request): Promise<Response> => {
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
      Deno.env.get(name),
    );
    const supabaseSecretKey = readSupabaseSecretKey();
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!runtimeConfiguration || !supabaseSecretKey || !supabaseUrl) {
      throw new Error('MISSING_SERVER_CONFIG');
    }

    const { originZip, packageId, price, destinationZip } = result.data;
    const destZip = destinationZip || '06500';

    const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey);
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
      fetch,
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

Deno.serve(
  withSentry(
    'get-shipping-quote',
    createGetShippingQuoteHandler({
      getUser: async (accessToken) => {
        const { data, error } = await supabaseAuth.auth.getUser(accessToken);
        return error || !data.user ? null : { id: data.user.id };
      },
      quote,
    }),
  ),
);
