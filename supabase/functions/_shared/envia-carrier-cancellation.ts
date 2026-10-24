import { extractEnviaPollingObservations } from './envia-tracking-ingestion.ts';
import type { EnviaPollingObservation } from './envia-tracking-ingestion.ts';
import { normalizeEnviaTrackingStatus } from './envia-tracking.ts';
import type { resolveEnviaRuntimeConfiguration } from './envia-shipping.ts';

export type EnviaCarrierConfiguration = NonNullable<
  ReturnType<typeof resolveEnviaRuntimeConfiguration>
>;

/** `unavailable`: Envia could not be asked (config, auth, rate limit); retry next run, no review. */
export type FreshTrackingState =
  'scanned' | 'unscanned' | 'unknown' | 'unavailable';

export interface FreshTrackingAssessment {
  state: FreshTrackingState;
  observations: EnviaPollingObservation[];
}

export type EnviaCancelResult =
  | { kind: 'response'; status: number; body: unknown }
  | { kind: 'transport_failure' };

export type EnviaCancelOutcome =
  | {
      outcome: 'accepted';
      balanceReturned: boolean;
      balanceReturnedAt: string | null;
    }
  | { outcome: 'refused'; errorCode: string | null }
  | { outcome: 'ambiguous' }
  | { outcome: 'unavailable' };

export interface EnviaCarrierRequestDependencies {
  fetch: typeof fetch;
  timeoutMs?: number;
  log?: (
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string,
    meta: Record<string, unknown>,
  ) => void;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const UNSCANNED_STATUSES = new Set([
  'created',
  'pending',
  'information',
  'n/a',
]);
const UNAVAILABLE_STATUSES = new Set([401, 403, 429]);

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const statusKey = (status: string) =>
  status.trim().replace(/\s+/g, ' ').toLowerCase();

// Same URL joining as generate-shipping-label (its helper is not exported).
const enviaEndpoint = (baseUrl: string, path: string) =>
  `${baseUrl}/${path}`.replace(/([^:]\/)\/+?/g, '$1');

export function assessFreshTracking(
  trackingNumber: string,
  observations: readonly EnviaPollingObservation[],
): FreshTrackingAssessment {
  const own = observations.filter(
    (observation) => observation.trackingNumber === trackingNumber,
  );
  if (own.length === 0) return { state: 'unknown', observations: own };

  if (
    own.some(
      (observation) =>
        normalizeEnviaTrackingStatus(observation.status).shipmentTransition !==
        null,
    )
  ) {
    return { state: 'scanned', observations: own };
  }

  const everyUnscanned = own.every((observation) =>
    UNSCANNED_STATUSES.has(statusKey(observation.status)),
  );
  return { state: everyUnscanned ? 'unscanned' : 'unknown', observations: own };
}

const errorCodeOf = (body: UnknownRecord): string | null => {
  const nested = isRecord(body.error) ? body.error.code : undefined;
  const code = nested ?? body.code;
  if (typeof code === 'number' && Number.isFinite(code)) return String(code);
  if (typeof code === 'string' && code.trim()) return code.trim();
  return null;
};

// The cancelled entry is `data` itself or the only element of a `data` array.
const cancelEntryOf = (body: UnknownRecord): UnknownRecord | null => {
  const { data } = body;
  if (Array.isArray(data)) {
    return data.length === 1 && isRecord(data[0]) ? data[0] : null;
  }
  return isRecord(data) ? data : null;
};

const trackingNumberMatches = (entry: UnknownRecord, requested: string) => {
  const value = entry.trackingNumber;
  if (typeof value === 'string') return value.trim() === requested.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value) === requested.trim();
  }
  return false;
};

const typeName = (value: unknown): string => {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
};

/** Structure only (key names and type names); never any value of the body. */
const cancelShape = (
  requestedTrackingNumber: string,
  result: EnviaCancelResult,
): Record<string, unknown> => {
  const body = result.kind === 'response' ? result.body : undefined;
  const record = isRecord(body) ? body : {};
  const data = record.data;
  const candidate = Array.isArray(data)
    ? data.length === 1
      ? data[0]
      : undefined
    : data;
  const entry = isRecord(candidate) ? candidate : null;
  return {
    topLevelKeys: Object.keys(record).sort(),
    dataType: typeName(data),
    ...(Array.isArray(data) ? { dataLength: data.length } : {}),
    ...(entry ? { entryKeys: Object.keys(entry).sort() } : {}),
    trackingNumberType: typeName(entry?.trackingNumber),
    balanceReturnedType: typeName(entry?.balanceReturned),
    balanceReturnDateType: typeName(entry?.balanceReturnDate),
    trackingNumberMatched: entry
      ? trackingNumberMatches(entry, requestedTrackingNumber)
      : false,
  };
};

export function classifyEnviaCancelResponse(
  requestedTrackingNumber: string,
  result: EnviaCancelResult,
): EnviaCancelOutcome {
  if (result.kind === 'transport_failure') return { outcome: 'ambiguous' };

  const { status, body } = result;
  if (UNAVAILABLE_STATUSES.has(status)) return { outcome: 'unavailable' };

  if (status >= 200 && status < 300) {
    const entry =
      isRecord(body) && body.meta === 'cancel' ? cancelEntryOf(body) : null;
    if (!entry || !trackingNumberMatches(entry, requestedTrackingNumber)) {
      return { outcome: 'ambiguous' };
    }
    const data = entry;
    const balanceReturned = data.balanceReturned === true;
    const returnedAt =
      balanceReturned && typeof data.balanceReturnDate === 'string'
        ? new Date(data.balanceReturnDate)
        : null;
    return {
      outcome: 'accepted',
      balanceReturned,
      balanceReturnedAt:
        returnedAt && !Number.isNaN(returnedAt.getTime())
          ? returnedAt.toISOString()
          : null,
    };
  }

  if (
    status >= 400 &&
    status < 500 &&
    isRecord(body) &&
    (body.meta === 'error' || Object.hasOwn(body, 'error'))
  ) {
    return { outcome: 'refused', errorCode: errorCodeOf(body) };
  }

  return { outcome: 'ambiguous' };
}

const postJson = async (
  config: EnviaCarrierConfiguration,
  path: string,
  payload: unknown,
  deps: EnviaCarrierRequestDependencies,
): Promise<EnviaCancelResult> => {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await deps.fetch(enviaEndpoint(config.apiUrl, path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return { kind: 'response', status: response.status, body };
  } catch {
    return { kind: 'transport_failure' };
  } finally {
    clearTimeout(timer);
  }
};

const safeMeta = (result: EnviaCancelResult): Record<string, unknown> => {
  if (result.kind === 'transport_failure') return { transportFailure: true };
  const body = isRecord(result.body) ? result.body : {};
  return {
    status: result.status,
    meta: typeof body.meta === 'string' ? body.meta : null,
    enviaErrorCode: errorCodeOf(body),
  };
};

const isInvalidTrackingEntry = (entry: unknown): boolean => {
  if (!isRecord(entry)) return true;
  const history = entry.history ?? entry.events;
  const observations = Array.isArray(history) ? history : [entry];
  return observations.some(
    (observation) =>
      !isRecord(observation) ||
      typeof observation.status !== 'string' ||
      observation.status.trim().length === 0,
  );
};

const unknownTracking: FreshTrackingAssessment = {
  state: 'unknown',
  observations: [],
};

const unavailableTracking: FreshTrackingAssessment = {
  state: 'unavailable',
  observations: [],
};

export async function fetchFreshTracking(
  config: EnviaCarrierConfiguration | null,
  trackingNumber: string,
  deps: EnviaCarrierRequestDependencies,
): Promise<FreshTrackingAssessment> {
  if (!config) return { ...unavailableTracking };

  const result = await postJson(
    config,
    'ship/generaltrack/',
    { trackingNumbers: [trackingNumber] },
    deps,
  );
  if (result.kind === 'response' && UNAVAILABLE_STATUSES.has(result.status)) {
    deps.log?.('WARN', 'Envia fresh tracking unavailable', safeMeta(result));
    return { ...unavailableTracking };
  }
  const body =
    result.kind === 'response' && isRecord(result.body) ? result.body : null;
  if (
    result.kind !== 'response' ||
    result.status < 200 ||
    result.status >= 300 ||
    !body ||
    body.meta === 'error' ||
    !Array.isArray(body.data) ||
    body.data.some(isInvalidTrackingEntry)
  ) {
    deps.log?.('WARN', 'Envia fresh tracking unavailable', safeMeta(result));
    return { ...unknownTracking };
  }

  return assessFreshTracking(
    trackingNumber,
    body.data.flatMap(extractEnviaPollingObservations),
  );
}

export async function requestEnviaLabelCancellation(
  config: EnviaCarrierConfiguration | null,
  input: { carrier: string; trackingNumber: string },
  deps: EnviaCarrierRequestDependencies,
): Promise<EnviaCancelOutcome> {
  if (!config) return { outcome: 'unavailable' };

  const result = await postJson(
    config,
    'ship/cancel/',
    { carrier: input.carrier, trackingNumber: input.trackingNumber },
    deps,
  );
  const classified = classifyEnviaCancelResponse(input.trackingNumber, result);
  deps.log?.('INFO', 'Envia label cancellation classified', {
    ...safeMeta(result),
    outcome: classified.outcome,
    shape: cancelShape(input.trackingNumber, result),
  });
  return classified;
}
