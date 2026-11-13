import { describe, expect, it } from 'bun:test';

import {
  hasStripeApiVersionDrift,
  reportStripeApiVersionDrift,
  type ApiVersionDriftReporter,
} from './api-version-drift.ts';

const EXPECTED = '2026-10-28.endive';

describe('hasStripeApiVersionDrift', () => {
  it('reports no drift for the same version', () => {
    expect(hasStripeApiVersionDrift('2026-10-28.endive', EXPECTED)).toBe(false);
  });

  it('reports no drift for a monthly version of the same release line', () => {
    expect(hasStripeApiVersionDrift('2026-11-25.endive', EXPECTED)).toBe(false);
  });

  it('reports drift for another release line', () => {
    expect(hasStripeApiVersionDrift('2025-12-15.clover', EXPECTED)).toBe(true);
    expect(hasStripeApiVersionDrift('2026-03-25.dahlia', EXPECTED)).toBe(true);
  });

  it('reports drift for a missing or malformed event version', () => {
    expect(hasStripeApiVersionDrift(null, EXPECTED)).toBe(true);
    expect(hasStripeApiVersionDrift(undefined, EXPECTED)).toBe(true);
    expect(hasStripeApiVersionDrift('', EXPECTED)).toBe(true);
    expect(hasStripeApiVersionDrift('endive', EXPECTED)).toBe(true);
    expect(hasStripeApiVersionDrift('2020-08-27', EXPECTED)).toBe(true);
    expect(hasStripeApiVersionDrift(42, EXPECTED)).toBe(true);
  });

  it('reports drift when the expected version itself is malformed', () => {
    expect(hasStripeApiVersionDrift('2026-10-28.endive', 'endive')).toBe(true);
  });
});

type ReportCall = Parameters<ApiVersionDriftReporter>;

const recorder = () => {
  const reports: ReportCall[] = [];
  const logs: Record<string, unknown>[] = [];
  return {
    reports,
    logs,
    deps: {
      expectedVersion: EXPECTED,
      reportMessage: async (...args: ReportCall) => {
        reports.push(args);
      },
      warn: (data: Record<string, unknown>) => {
        logs.push(data);
      },
    },
  };
};

describe('reportStripeApiVersionDrift', () => {
  it('reports an event from another release line to Sentry with its id, type, and both versions', async () => {
    const { reports, logs, deps } = recorder();
    await reportStripeApiVersionDrift(
      {
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        api_version: '2025-12-15.clover',
      },
      deps,
    );
    expect(reports).toEqual([
      [
        'stripe-webhooks received an event in Stripe API version 2025-12-15.clover; expected the release line of 2026-10-28.endive',
        {
          fingerprint: [
            'stripe-webhooks-api-version-drift',
            '2025-12-15.clover',
          ],
          tags: {
            edge_function: 'stripe-webhooks',
            stripe_event_id: 'evt_1',
            stripe_event_type: 'payment_intent.succeeded',
            event_api_version: '2025-12-15.clover',
            expected_api_version: EXPECTED,
          },
        },
      ],
    ]);
    expect(logs).toEqual([
      {
        event_id: 'evt_1',
        event_type: 'payment_intent.succeeded',
        event_api_version: '2025-12-15.clover',
        expected_api_version: EXPECTED,
      },
    ]);
  });

  it('reports an event without an api_version as missing', async () => {
    const { reports, deps } = recorder();
    await reportStripeApiVersionDrift(
      { id: 'evt_2', type: 'payout.paid', api_version: null },
      deps,
    );
    expect(reports).toHaveLength(1);
    expect(reports[0][1].fingerprint).toEqual([
      'stripe-webhooks-api-version-drift',
      'missing',
    ]);
    expect(reports[0][1].tags.event_api_version).toBe('missing');
  });

  it('reports nothing for an event in the same release line', async () => {
    const { reports, logs, deps } = recorder();
    await reportStripeApiVersionDrift(
      { id: 'evt_3', type: 'payout.paid', api_version: '2026-11-25.endive' },
      deps,
    );
    expect(reports).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('never throws when the Sentry reporter fails, so the event is still processed', async () => {
    const { deps } = recorder();
    await expect(
      reportStripeApiVersionDrift(
        { id: 'evt_4', type: 'payout.paid', api_version: '2025-12-15.clover' },
        {
          ...deps,
          reportMessage: async () => {
            throw new Error('sentry down');
          },
        },
      ),
    ).resolves.toBeUndefined();
  });
});
