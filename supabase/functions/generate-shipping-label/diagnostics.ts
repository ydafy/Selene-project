type EnviaPackage = {
  [key: string]: unknown;
  type?: unknown;
  amount?: unknown;
  declaredValue?: unknown;
  weight?: unknown;
  dimensions?: unknown;
  lengthUnit?: unknown;
  weightUnit?: unknown;
};

type EnviaPayload = {
  origin?: {
    [key: string]: unknown;
    state?: unknown;
    postalCode?: unknown;
    city?: unknown;
  };
  destination?: {
    [key: string]: unknown;
    state?: unknown;
    postalCode?: unknown;
    city?: unknown;
  };
  packages?: EnviaPackage[];
  shipment?: {
    carrier?: unknown;
    service?: unknown;
    type?: unknown;
  };
  settings?: {
    currency?: unknown;
    printFormat?: unknown;
    printSize?: unknown;
  };
};

type EnviaDiagnosticsContext = {
  shipmentId: string;
  endpointBaseUrl?: string | null;
  mode: string;
  presetKeys?: string[];
  itemCount?: number;
};

type AmountCandidate = {
  path: string;
  value: number;
  unit: 'cents' | 'pesos';
  priority: number;
};

export type EnviaLabelCostExtraction = {
  shippingCostCents: number;
  sourcePath: string;
};

const LABEL_COST_FIELD_NAMES = new Set([
  'shippingCost',
  'shipping_cost',
  'cost',
  'price',
  'totalPrice',
  'total_price',
  'totalCost',
  'total_cost',
  'total',
  'rate',
]);

// Envia can use `amount` for a final quote amount, but request/package payloads
// also use it as a quantity. Keep it only as a last-resort cost signal.
const LABEL_COST_LAST_RESORT_FIELD_NAMES = new Set(['amount']);

const LABEL_COST_CENTS_FIELD_NAMES = new Set([
  'shippingCostCents',
  'shipping_cost_cents',
  'costCents',
  'cost_cents',
  'priceCents',
  'price_cents',
  'totalCents',
  'total_cents',
  'amountCents',
  'amount_cents',
]);

const normalizeEndpointBaseUrl = (endpointBaseUrl?: string | null) => {
  if (!endpointBaseUrl) return null;

  try {
    const url = new URL(endpointBaseUrl);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return endpointBaseUrl.split('?')[0].replace(/\/$/, '');
  }
};

const summarizeAddress = (address: EnviaPayload['origin']) => ({
  state: address?.state ?? null,
  postalCode: address?.postalCode ?? null,
  city: address?.city ?? null,
});

export const buildSanitizedEnviaDiagnostics = (
  payload: EnviaPayload,
  context: EnviaDiagnosticsContext,
) => ({
  shipmentId: context.shipmentId,
  endpointBaseUrl: normalizeEndpointBaseUrl(context.endpointBaseUrl),
  mode: context.mode,
  carrier: payload.shipment?.carrier ?? null,
  service: payload.shipment?.service ?? null,
  shipmentType: payload.shipment?.type ?? null,
  printFormat: payload.settings?.printFormat ?? null,
  printSize: payload.settings?.printSize ?? null,
  currency: payload.settings?.currency ?? null,
  origin: summarizeAddress(payload.origin),
  destination: summarizeAddress(payload.destination),
  packageCount: payload.packages?.length ?? 0,
  packages: (payload.packages ?? []).map((pkg) => ({
    type: pkg.type ?? null,
    amount: pkg.amount ?? null,
    declaredValue: pkg.declaredValue ?? null,
    weight: pkg.weight ?? null,
    dimensions: pkg.dimensions ?? null,
    lengthUnit: pkg.lengthUnit ?? null,
    weightUnit: pkg.weightUnit ?? null,
  })),
  itemCount: context.itemCount ?? null,
  presetKeys: context.presetKeys ?? [],
});

const SAFE_LABEL_LOG_FIELDS = new Set([
  'shipmentId',
  'errorClass',
  'resultStatus',
  'isApiError',
  'enviaDiagnostics',
  'enviaError',
  'enviaResponseMetadata',
]);

/** Restrict log metadata to values built by the explicit diagnostic sanitizers. */
export const sanitizeLabelLogMetadata = (metadata: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(metadata).filter(([key]) => SAFE_LABEL_LOG_FIELDS.has(key)),
  );

export const extractEnviaErrorMetadata = (enviaResponse: unknown) => {
  if (!enviaResponse || typeof enviaResponse !== 'object') return null;

  const response = enviaResponse as Record<string, unknown>;
  const nestedError =
    response.error && typeof response.error === 'object'
      ? (response.error as Record<string, unknown>)
      : {};

  return {
    topLevelKeys: Object.keys(response).sort(),
    code: response.code ?? nestedError.code ?? null,
  };
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/[$,\s]/g, '');
    if (normalized.length === 0) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const collectAmountCandidates = (
  value: unknown,
  path = '$',
  depth = 0,
): AmountCandidate[] => {
  if (depth > 4 || !value || typeof value !== 'object') return [];

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);

  return entries.flatMap(([key, nestedValue]) => {
    const nestedPath = `${path}.${key}`;
    const amount = toFiniteNumber(nestedValue);
    const directCandidate =
      amount !== null && amount >= 0
        ? LABEL_COST_CENTS_FIELD_NAMES.has(key)
          ? [
              {
                path: nestedPath,
                value: amount,
                unit: 'cents' as const,
                priority: 0,
              },
            ]
          : LABEL_COST_FIELD_NAMES.has(key)
            ? [
                {
                  path: nestedPath,
                  value: amount,
                  unit: 'pesos' as const,
                  priority: 1,
                },
              ]
            : LABEL_COST_LAST_RESORT_FIELD_NAMES.has(key)
              ? [
                  {
                    path: nestedPath,
                    value: amount,
                    unit: 'pesos' as const,
                    priority: 2,
                  },
                ]
              : []
        : [];

    if (nestedValue && typeof nestedValue === 'object') {
      return [
        ...directCandidate,
        ...collectAmountCandidates(nestedValue, nestedPath, depth + 1),
      ];
    }

    return directCandidate;
  });
};

const getPreferredSearchRoots = (enviaResponse: unknown): unknown[] => {
  if (!isRecord(enviaResponse)) return [enviaResponse];

  const data = enviaResponse.data;
  const firstDataItem = Array.isArray(data) ? data[0] : data;

  return [
    firstDataItem,
    isRecord(firstDataItem) ? firstDataItem.shipment : undefined,
    isRecord(firstDataItem) ? firstDataItem.rate : undefined,
    isRecord(firstDataItem) ? firstDataItem.quote : undefined,
    enviaResponse.shipment,
    enviaResponse.rate,
    enviaResponse.quote,
    enviaResponse,
  ].filter((root) => root !== undefined);
};

export const extractEnviaLabelCostCents = (
  enviaResponse: unknown,
): EnviaLabelCostExtraction | null => {
  const candidates = getPreferredSearchRoots(enviaResponse).flatMap((root) =>
    collectAmountCandidates(root),
  );

  candidates.sort((left, right) => left.priority - right.priority);

  for (const candidate of candidates) {
    const shippingCostCents =
      candidate.unit === 'cents'
        ? Math.round(candidate.value)
        : Math.round(candidate.value * 100);

    if (shippingCostCents >= 0) {
      return { shippingCostCents, sourcePath: candidate.path };
    }
  }

  return null;
};

const summarizeKeys = (value: unknown) =>
  isRecord(value) ? Object.keys(value).sort() : [];

export const buildSanitizedEnviaResponseMetadata = (
  enviaResponse: unknown,
  extraction: EnviaLabelCostExtraction | null,
) => {
  const response = isRecord(enviaResponse) ? enviaResponse : {};
  const data = response.data;
  const firstDataItem = Array.isArray(data) ? data[0] : data;
  const amountCandidates = getPreferredSearchRoots(enviaResponse)
    .flatMap((root) => collectAmountCandidates(root))
    .map((candidate) => ({
      path: candidate.path,
      unit: candidate.unit,
      normalizedCents:
        candidate.unit === 'cents'
          ? Math.round(candidate.value)
          : Math.round(candidate.value * 100),
    }));

  return {
    topLevelKeys: summarizeKeys(enviaResponse),
    dataItemKeys: summarizeKeys(firstDataItem),
    amountCandidates,
    selectedCostSourcePath: extraction?.sourcePath ?? null,
    selectedShippingCostCents: extraction?.shippingCostCents ?? null,
  };
};
