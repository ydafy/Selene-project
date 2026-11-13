import type { SentryMessageOptions } from '../_shared/sentry.ts';

// A Stripe API version is `<YYYY-MM-DD>.<release>`. Monthly versions keep the
// release name and add no breaking changes, so only the release is compared.
const API_VERSION = /^\d{4}-\d{2}-\d{2}\.([a-z]+)$/;

const releaseLine = (version: unknown): string | null => {
  if (typeof version !== 'string') return null;
  return API_VERSION.exec(version)?.[1] ?? null;
};

/**
 * True when an event's `api_version` is missing, malformed, or in another
 * release line than `expectedVersion` (`STRIPE_API_VERSION`).
 */
export function hasStripeApiVersionDrift(
  eventApiVersion: unknown,
  expectedVersion: string,
): boolean {
  const expected = releaseLine(expectedVersion);
  return expected === null || releaseLine(eventApiVersion) !== expected;
}

export type ApiVersionDriftReporter = (
  message: string,
  options: SentryMessageOptions,
) => Promise<void>;

export interface ApiVersionDriftDeps {
  expectedVersion: string;
  /** `reportMessage` from `_shared/sentry.ts`. */
  reportMessage: ApiVersionDriftReporter;
  warn: (data: Record<string, unknown>) => void;
}

/**
 * Reports a verified event whose API version drifted from `STRIPE_API_VERSION`.
 * It never throws and never rejects the event: production must keep processing
 * every signed event, and the report is the signal to move the endpoints.
 */
export async function reportStripeApiVersionDrift(
  event: { id: string; type: string; api_version?: string | null },
  deps: ApiVersionDriftDeps,
): Promise<void> {
  if (!hasStripeApiVersionDrift(event.api_version, deps.expectedVersion)) {
    return;
  }
  const eventVersion =
    typeof event.api_version === 'string' && event.api_version !== ''
      ? event.api_version
      : 'missing';
  try {
    deps.warn({
      event_id: event.id,
      event_type: event.type,
      event_api_version: eventVersion,
      expected_api_version: deps.expectedVersion,
    });
    await deps.reportMessage(
      `stripe-webhooks received an event in Stripe API version ${eventVersion}; expected the release line of ${deps.expectedVersion}`,
      {
        fingerprint: ['stripe-webhooks-api-version-drift', eventVersion],
        tags: {
          edge_function: 'stripe-webhooks',
          stripe_event_id: event.id,
          stripe_event_type: event.type,
          event_api_version: eventVersion,
          expected_api_version: deps.expectedVersion,
        },
      },
    );
  } catch {
    // Reporting is best effort; the event is processed either way.
  }
}
