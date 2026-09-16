import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://esm.sh/zod@3.23.8";
import { QuoteContractError, quoteListingShipment } from "./quote-contract.ts";
import { resolveProductionQuoteRuntime } from "./runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z.object({
  originZip: z.string().regex(/^\d{4,5}$/),
  packageId: z.string().trim().min(1).max(100),
  price: z.number().finite().positive(),
  destinationZip: z.string().regex(/^\d{4,5}$/).optional(),
});

const log = (level: string, message: string, meta?: unknown) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: "get-shipping-quote",
      level,
      message,
      ...((meta as Record<string, unknown>) || {}),
    }),
  );
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const runtimeConfiguration = resolveProductionQuoteRuntime((name) =>
      Deno.env.get(name)
    );
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!runtimeConfiguration || !serviceRoleKey || !supabaseUrl) {
      throw new Error("MISSING_SERVER_CONFIG");
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new Error("INVALID_INPUT");
    }
    const result = RequestSchema.safeParse(body);
    if (!result.success) {
      log("error", "INVALID_INPUT");
      throw new Error("INVALID_INPUT");
    }

    const { originZip, packageId, price, destinationZip } = result.data;
    const destZip = destinationZip || "06500";

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    let sys: { package_presets: unknown } | null = null;
    try {
      const { data, error: systemSettingsError } = await supabaseAdmin
        .from("system_settings")
        .select("package_presets")
        .eq("id", 1)
        .single();
      if (systemSettingsError || !data) {
        throw new Error("SYSTEM_CONFIG_NOT_FOUND");
      }
      sys = data;
    } catch {
      throw new Error("SYSTEM_CONFIG_NOT_FOUND");
    }

    if (!sys.package_presets) {
      throw new Error("SYSTEM_CONFIG_NOT_FOUND");
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
      log: (event) => log("info", String(event.event), event),
    });

    return new Response(JSON.stringify({ rates }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const code = err instanceof QuoteContractError
      ? err.code
      : err instanceof Error && [
          "INVALID_INPUT",
          "MISSING_SERVER_CONFIG",
          "SYSTEM_CONFIG_NOT_FOUND",
        ].includes(err.message)
      ? err.message
      : "PROVIDER_NETWORK_ERROR";
    const status = code === "INVALID_INPUT" ||
        code === "UNKNOWN_PACKAGE_PRESET" ||
        code === "INVALID_PACKAGE_PRESET"
      ? 422
      : code === "PROVIDER_TIMEOUT"
      ? 504
      : code.startsWith("PROVIDER_")
      ? 502
      : 500;
    log("error", code);
    return new Response(JSON.stringify({ error: code }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
