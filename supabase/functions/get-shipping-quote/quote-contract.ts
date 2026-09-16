import {
  buildEnviaQuoteConfiguration,
  buildPaquetexpressGroundQuote,
} from "../_shared/envia-shipping.ts";

const providerTimeoutMs = 10_000;

export type QuoteErrorCode =
  | "UNKNOWN_PACKAGE_PRESET"
  | "INVALID_PACKAGE_PRESET"
  | "PROVIDER_HTTP_ERROR"
  | "PROVIDER_MALFORMED_RESPONSE"
  | "PROVIDER_RATE_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_NETWORK_ERROR";

export class QuoteContractError extends Error {
  constructor(readonly code: QuoteErrorCode) {
    super(code);
  }
}

export type ResolvedPackagePreset = {
  id: string;
  weight: number;
  length: number;
  width: number;
  height: number;
};

const asSafePositiveNumber = (value: unknown): number | null => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const number = Number(value);
  return Number.isFinite(number) && number > 0 &&
      number <= Number.MAX_SAFE_INTEGER
    ? number
    : null;
};

export function resolvePackagePreset(
  packagePresets: unknown,
  requestedPackageId: string,
): ResolvedPackagePreset {
  if (
    typeof packagePresets !== "object" ||
    packagePresets === null ||
    Array.isArray(packagePresets)
  ) {
    throw new QuoteContractError("UNKNOWN_PACKAGE_PRESET");
  }

  const preset =
    (packagePresets as Record<string, unknown>)[requestedPackageId];
  if (typeof preset !== "object" || preset === null || Array.isArray(preset)) {
    throw new QuoteContractError("UNKNOWN_PACKAGE_PRESET");
  }

  const source = preset as Record<string, unknown>;
  const weight = asSafePositiveNumber(source.weight);
  const length = asSafePositiveNumber(source.length);
  const width = asSafePositiveNumber(source.width);
  const height = asSafePositiveNumber(source.height);
  if (weight === null || length === null || width === null || height === null) {
    throw new QuoteContractError("INVALID_PACKAGE_PRESET");
  }

  return { id: requestedPackageId, weight, length, width, height };
}

type QuoteLog = (event: Record<string, unknown>) => void;

type QuoteInput = {
  requestedPackageId: string;
  packagePresets: unknown;
  originZip: string;
  destinationZip: string;
  price: number;
  runtimeMode: "sandbox" | "production";
  apiUrl: string;
  apiKey: string;
  fetch: typeof globalThis.fetch;
  log?: QuoteLog;
};

const providerChargeFields = [
  "basePrice",
  "additionalCharges",
  "discount",
  "tax",
  "taxes",
  "insurance",
  "fuelSurcharge",
] as const;

const sanitizeProviderCharges = (rate: unknown): Record<string, number> => {
  if (typeof rate !== "object" || rate === null || Array.isArray(rate)) {
    return {};
  }
  const source = rate as Record<string, unknown>;
  return Object.fromEntries(
    providerChargeFields.flatMap((field) => {
      const amount = asSafePositiveNumber(source[field]);
      return amount === null ? [] : [[field, amount]];
    }),
  );
};

const totalProviderPrice = (rate: unknown): number | null => {
  if (typeof rate !== "object" || rate === null || Array.isArray(rate)) {
    return null;
  }
  const source = rate as Record<string, unknown>;
  return asSafePositiveNumber(
    source.totalPrice ?? source.total_price ?? source.price,
  );
};

const classifyTransportError = (error: unknown): QuoteErrorCode => {
  if (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return "PROVIDER_TIMEOUT";
  }
  return "PROVIDER_NETWORK_ERROR";
};

export async function quoteListingShipment(input: QuoteInput): Promise<{
  rates: NonNullable<ReturnType<typeof buildPaquetexpressGroundQuote>>[];
}> {
  let preset: ResolvedPackagePreset;
  try {
    preset = resolvePackagePreset(
      input.packagePresets,
      input.requestedPackageId,
    );
  } catch (error) {
    const code = error instanceof QuoteContractError
      ? error.code
      : "INVALID_PACKAGE_PRESET";
    input.log?.({
      event: "shipping_quote_preset_rejected",
      requestedPresetId: input.requestedPackageId,
      resolvedPresetId: null,
      presetFound: code !== "UNKNOWN_PACKAGE_PRESET",
      errorCode: code,
    });
    throw error;
  }

  const payload = {
    origin: {
      name: "Selene Seller",
      company: "Selene Marketplace",
      email: "soporte@selene.com",
      phone: "5512345678",
      street: "Av. Principal",
      number: "123",
      district: "Centro",
      city: "Mexico",
      state: "MX",
      country: "MX",
      postalCode: input.originZip.padStart(5, "0"),
    },
    destination: {
      name: "Selene Buyer",
      company: "Particular",
      email: "comprador@selene.com",
      phone: "5512345678",
      street: "Av. Destino",
      number: "456",
      district: "Centro",
      city: "Mexico",
      state: "MX",
      country: "MX",
      postalCode: input.destinationZip.padStart(5, "0"),
    },
    packages: [
      {
        type: "box",
        content: "Hardware de PC",
        amount: 1,
        name: preset.id,
        declaredValue: input.price,
        lengthUnit: "CM",
        weightUnit: "KG",
        weight: preset.weight,
        dimensions: {
          length: preset.length,
          width: preset.width,
          height: preset.height,
        },
      },
    ],
    ...buildEnviaQuoteConfiguration(),
  };

  let response: Response;
  try {
    response = await input.fetch(new URL("ship/rate/", input.apiUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(providerTimeoutMs),
    });
  } catch (error) {
    const code = classifyTransportError(error);
    input.log?.({ event: "shipping_quote_provider_failed", errorCode: code });
    throw new QuoteContractError(code);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    input.log?.({
      event: "shipping_quote_provider_failed",
      errorCode: "PROVIDER_MALFORMED_RESPONSE",
      providerStatus: response.status,
    });
    throw new QuoteContractError("PROVIDER_MALFORMED_RESPONSE");
  }

  if (!response.ok) {
    input.log?.({
      event: "shipping_quote_provider_failed",
      errorCode: "PROVIDER_HTTP_ERROR",
      providerStatus: response.status,
    });
    throw new QuoteContractError("PROVIDER_HTTP_ERROR");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new QuoteContractError("PROVIDER_MALFORMED_RESPONSE");
  }
  const rates = (body as Record<string, unknown>).data;
  if (!Array.isArray(rates)) {
    throw new QuoteContractError("PROVIDER_MALFORMED_RESPONSE");
  }

  const quote = buildPaquetexpressGroundQuote(rates);
  if (!quote) throw new QuoteContractError("PROVIDER_RATE_UNAVAILABLE");

  const selectedRate = rates.find(
    (rate) => buildPaquetexpressGroundQuote([rate]) !== null,
  );
  input.log?.({
    event: "shipping_quote_resolved",
    requestedPresetId: input.requestedPackageId,
    resolvedPresetId: preset.id,
    presetFound: true,
    weight: preset.weight,
    dimensions: {
      length: preset.length,
      width: preset.width,
      height: preset.height,
    },
    originZipPresent: input.originZip.length > 0,
    originZipFormatValidated: true,
    destinationZipPresent: input.destinationZip.length > 0,
    destinationZipFormatValidated: true,
    destinationIsListingReference: input.destinationZip === "06500",
    runtimeMode: input.runtimeMode,
    carrier: quote.carrier,
    service: quote.service,
    currency: "MXN",
    providerTotalPrice: totalProviderPrice(selectedRate),
    providerCharges: sanitizeProviderCharges(selectedRate),
  });

  return { rates: [quote] };
}
