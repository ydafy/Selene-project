import { z } from './zod-runtime.ts';
import { normalizeEnviaMexicoStateCode } from './envia-mexico-states.ts';

const requiredAddressField = z.string().trim().min(1);
export function normalizeEnviaStateCode(value: unknown): string | null {
  return normalizeEnviaMexicoStateCode(value);
}

const mexicanStateCodeSchema = z.string().transform((value, context) => {
  const normalized = normalizeEnviaStateCode(value);
  if (normalized) return normalized;
  context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Mexican state code' });
  return z.NEVER;
});

const providerDestinationSchema = z.object({
  name: requiredAddressField,
  phone: requiredAddressField,
  street: requiredAddressField,
  number: requiredAddressField.optional(),
  district: requiredAddressField,
  city: requiredAddressField,
  state: mexicanStateCodeSchema,
  country: z.literal('MX'),
  postalCode: z.string().regex(/^\d{5}$/),
}).strict();

export const listingReferenceDestinationSchema = providerDestinationSchema;
export const buyerDestinationSnapshotSchema = providerDestinationSchema;

export const enviaShipmentConfigurationSchema = z.object({
  envia_carrier: requiredAddressField,
  envia_service: requiredAddressField,
  envia_print_format: requiredAddressField,
  envia_print_size: requiredAddressField,
}).strict();

export type EnviaDestination = z.infer<typeof providerDestinationSchema>;
export type EnviaGenerateOutcome = 'retryable_rejected' | 'orphan_pending';

export function buildBuyerDestinationFromStoredSnapshot(snapshot: unknown): EnviaDestination | null {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return null;
  const source = snapshot as Record<string, unknown>;
  const candidate = {
    name: source.full_name,
    phone: source.phone,
    street: source.street_line1,
    ...(typeof source.street_number === 'string' && source.street_number.trim() !== ''
      ? { number: source.street_number }
      : {}),
    district: source.district,
    city: source.city,
    state: normalizeEnviaStateCode(source.state),
    country: source.country,
    postalCode: source.zip_code,
  };
  const parsed = buyerDestinationSnapshotSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function buildSellerOriginFromStoredAddress(address: unknown): EnviaDestination | null {
  if (typeof address !== 'object' || address === null || Array.isArray(address)) return null;
  const source = address as Record<string, unknown>;
  const candidate = {
    name: source.full_name,
    phone: source.phone,
    street: source.street_line1,
    number: source.street_number,
    district: source.district,
    city: source.city,
    state: normalizeEnviaStateCode(source.state ?? source.state_code),
    country: source.country,
    postalCode: source.zip_code,
  };
  const parsed = providerDestinationSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Paquetexpress rejects incomplete domestic addresses even where Envia marks a field optional. */
export function runPaquetexpressAddressPreflight(
  origin: EnviaDestination | null,
  destination: EnviaDestination | null,
): 'SELLER_ORIGIN_CORRECTION_REQUIRED' | 'BUYER_DESTINATION_CORRECTION_REQUIRED' | null {
  const complete = (address: EnviaDestination | null) =>
    address !== null && requiredAddressField.safeParse(address.number).success;
  if (!complete(origin)) return 'SELLER_ORIGIN_CORRECTION_REQUIRED';
  if (!complete(destination)) return 'BUYER_DESTINATION_CORRECTION_REQUIRED';
  return null;
}

export function resolveEnviaRuntimeConfiguration(
  environment: Record<string, string | undefined>,
  options: { allowInsecureLocalhost?: boolean } = {},
): { mode: 'sandbox' | 'production'; apiKey: string; apiUrl: string } | null {
  const mode = environment.ENVIA_MODE;
  if (mode !== 'sandbox' && mode !== 'production') return null;
  const apiKey = environment[mode === 'sandbox' ? 'ENVIA_API_KEY_SANDBOX' : 'ENVIA_API_KEY_PROD']?.trim();
  const rawUrl = environment[mode === 'sandbox' ? 'ENVIA_API_URL_SANDBOX' : 'ENVIA_API_URL_PROD']?.trim();
  if (!apiKey || !rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const localTestSeam = options.allowInsecureLocalhost && url.protocol === 'http:' && url.hostname === 'localhost';
    return url.protocol === 'https:' || localTestSeam
      ? { mode, apiKey, apiUrl: url.toString() }
      : null;
  } catch {
    return null;
  }
}

export function projectEnviaShipmentConfiguration(settings: Record<string, unknown>) {
  return {
    envia_carrier: settings.envia_carrier,
    envia_service: settings.envia_service,
    envia_print_format: settings.envia_print_format,
    envia_print_size: settings.envia_print_size,
  };
}

export function buildEnviaShipmentConfiguration(settings: unknown) {
  const parsed = enviaShipmentConfigurationSchema.safeParse(settings);
  if (!parsed.success) return null;

  const { envia_carrier, envia_service, envia_print_format, envia_print_size } = parsed.data;
  if (
    envia_carrier.trim().toLowerCase() !== 'paquetexpress' ||
    envia_service.trim().toLowerCase().replace(/\s+/g, ' ') !==
      'ground'
  ) {
    return null;
  }

  return {
    shipment: { carrier: envia_carrier, service: envia_service, type: 1 },
    settings: { currency: 'MXN', printFormat: envia_print_format, printSize: envia_print_size },
  };
}

type EnviaResponse = {
  status: number;
  body: Record<string, unknown>;
};

type EnviaTransportFailure = {
  kind: 'timeout' | 'connection_lost' | 'malformed_response';
};

export function classifyEnviaGenerateOutcome(
  result: EnviaResponse | EnviaTransportFailure,
): EnviaGenerateOutcome {
  if ('kind' in result) return 'orphan_pending';

  const hasLabelIdentifier =
    typeof result.body.trackingNumber === 'string' ||
    typeof result.body.labelUrl === 'string' ||
    typeof result.body.shipmentId === 'string';
  const code = typeof result.body.code === 'string' ? result.body.code.toUpperCase() : null;
  const hasProviderError = typeof result.body.error === 'string' || code !== null;
  const deterministicValidationCodes = new Set([
    'VALIDATION_ERROR', 'INVALID_ADDRESS', 'INVALID_DESTINATION', 'INVALID_ORIGIN',
  ]);

  if (
    result.status >= 400 && result.status < 500 && hasProviderError && !hasLabelIdentifier &&
    (code === null || deterministicValidationCodes.has(code))
  ) {
    return 'retryable_rejected';
  }

  return 'orphan_pending';
}

export function toMxnCents(totalPrice: unknown): number | null {
  if (
    (typeof totalPrice !== 'number' && typeof totalPrice !== 'string') ||
    (typeof totalPrice === 'string' && totalPrice.trim() === '')
  ) {
    return null;
  }

  const amount = Number(totalPrice);
  if (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER / 100) {
    return null;
  }

  const cents = Math.round((amount + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

type EnviaRate = Record<string, unknown>;

export type AcceptedEnviaRate = {
  carrier: string;
  service: string;
  quoteReference: string | null;
  quotedCostCents: number;
};

const normalizeRateIdentity = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized || null;
};

const rateQuoteReference = (rate: EnviaRate): string | null => {
  for (const key of ['quoteId', 'quote_id', 'id', 'reference']) {
    const value = rate[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

/**
 * Select the sole Envia option permitted by Selene's shipping policy.  This is
 * intentionally not a cheapest-rate selector: ambiguous or incomplete rate
 * responses must stop label generation before a provider label is created.
 */
export function selectPaquetexpressGroundRate(
  rates: unknown,
): AcceptedEnviaRate | null {
  if (!Array.isArray(rates)) return null;

  const matches = rates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }

    const rate = candidate as EnviaRate;
    if (
      normalizeRateIdentity(rate.carrier) !== 'paquetexpress' ||
      normalizeRateIdentity(rate.service) !== 'ground' ||
      normalizeRateIdentity(rate.currency) !== 'mxn'
    ) {
      return [];
    }

    const quotedCostCents = toMxnCents(
      rate.totalPrice ?? rate.total_price ?? rate.price,
    );
    if (quotedCostCents === null) return [];

    return [{
      carrier: rate.carrier as string,
      service: rate.service as string,
      quoteReference: rateQuoteReference(rate),
      quotedCostCents,
    }];
  });

  return matches.length === 1 ? matches[0] : null;
}

const safeDiagnosticFields = new Set([
  'estimatePolicy',
  'carrier',
  'service',
  'printFormat',
  'printSize',
  'city',
  'state',
  'postalCode',
  'responseKeys',
  'errorClass',
]);

export function redactEnviaDiagnostics(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => safeDiagnosticFields.has(key)),
  );
}

export type LabelClaimStatus =
  | 'claimed'
  | 'generated'
  | 'orphan_pending'
  | 'ineligible'
  | 'not_found'
  | 'claimed_conflict';

export type LabelClaimResult = {
  status: LabelClaimStatus;
  claimToken?: string;
};

export type LabelProviderResult<T = never> =
  | 'accepted'
  | 'rejected'
  | 'ambiguous'
  | { status: 'accepted'; accepted: T }
  | { status: 'rejected' }
  | { status: 'ambiguous' };

type LabelClaimOrchestrationResult<T> =
  | {
    status:
      | Exclude<LabelClaimStatus, 'generated'>
      | 'retryable_rejected'
      | 'rate_evidence_rejected'
      | 'rate_evidence_state_persistence_failed'
      | 'mark_sent_released'
      | 'mark_sent_failed'
      | 'configuration_invalid'
      | 'buyer_destination_invalid'
      | 'rejected_state_persistence_failed'
      | 'orphan_state_persistence_failed';
  }
  | { status: 'generated'; accepted?: T };

export async function runLabelClaimOrchestration<T>(dependencies: {
  preflight?: () => Promise<'configuration_invalid' | 'buyer_destination_invalid' | null>;
  claim: () => Promise<LabelClaimResult>;
  /** Rate exact shipment inputs and atomically persist the accepted evidence. */
  rateAndPersist?: (claimToken: string) => Promise<boolean>;
  markSent: (claimToken: string) => Promise<boolean>;
  provider: () => Promise<LabelProviderResult<T>>;
  finalize: (claimToken: string, accepted: T | null) => Promise<boolean>;
  rejected: (claimToken: string) => Promise<boolean>;
  orphan: (claimToken: string) => Promise<boolean>;
}): Promise<LabelClaimOrchestrationResult<T>> {
  const preflight = await dependencies.preflight?.();
  if (preflight) return { status: preflight };
  const claim = await dependencies.claim();
  if (claim.status !== 'claimed' || !claim.claimToken) return { status: claim.status };

  if (dependencies.rateAndPersist) {
    try {
      if (!await dependencies.rateAndPersist(claim.claimToken)) {
        return await dependencies.rejected(claim.claimToken)
          ? { status: 'rate_evidence_rejected' }
          : { status: 'rate_evidence_state_persistence_failed' };
      }
    } catch {
      try {
        return await dependencies.rejected(claim.claimToken)
          ? { status: 'rate_evidence_rejected' }
          : { status: 'rate_evidence_state_persistence_failed' };
      } catch {
        return { status: 'rate_evidence_state_persistence_failed' };
      }
    }
  }

  if (!await dependencies.markSent(claim.claimToken)) {
    if (await dependencies.rejected(claim.claimToken)) return { status: 'mark_sent_released' };
    return { status: 'mark_sent_failed' };
  }

  const providerResult = await dependencies.provider();
  const providerStatus =
    typeof providerResult === 'string' ? providerResult : providerResult.status;
  if (providerStatus === 'rejected') {
    try {
      return await dependencies.rejected(claim.claimToken)
        ? { status: 'retryable_rejected' }
        : { status: 'rejected_state_persistence_failed' };
    } catch {
      return { status: 'rejected_state_persistence_failed' };
    }
  }
  if (providerStatus === 'ambiguous') {
    try {
      return await dependencies.orphan(claim.claimToken)
        ? { status: 'orphan_pending' }
        : { status: 'orphan_state_persistence_failed' };
    } catch {
      return { status: 'orphan_state_persistence_failed' };
    }
  }

  const accepted =
    typeof providerResult === 'object' && providerResult.status === 'accepted'
      ? providerResult.accepted
      : null;
  try {
    if (await dependencies.finalize(claim.claimToken, accepted)) {
      return accepted === null
        ? { status: 'generated' }
        : { status: 'generated', accepted };
    }
  } catch {
    // A failed finalization leaves provider acceptance unproven until orphan persistence succeeds.
  }
  try {
    return await dependencies.orphan(claim.claimToken)
      ? { status: 'orphan_pending' }
      : { status: 'orphan_state_persistence_failed' };
  } catch {
    return { status: 'orphan_state_persistence_failed' };
  }
}
