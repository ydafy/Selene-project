import { describe, expect, it } from 'bun:test';

import {
  HarnessAssertionError,
  HarnessValidationError,
  parseConfirmationHarnessConfig,
  runConfirmationHarness,
} from './confirm-shipment-delivery-harness';

const fixtureEnvironment = {
  CONFIRMATION_HARNESS_APPROVAL: 'I_CONFIRM_DISPOSABLE_FIXTURES',
  CONFIRM_SHIPMENT_DELIVERY_URL:
    'https://example.test/functions/v1/confirm-shipment-delivery',
  CONFIRM_SHIPMENT_DELIVERY_BEARER_TOKEN: 'buyer-access-token',
  CONFIRMATION_DELIVERED_ORDER_ID: '11111111-1111-4111-8111-111111111111',
  CONFIRMATION_DELIVERED_SHIPMENT_ID: '22222222-2222-4222-8222-222222222222',
  CONFIRMATION_SHIPPED_ORDER_ID: '33333333-3333-4333-8333-333333333333',
  CONFIRMATION_SHIPPED_SHIPMENT_ID: '44444444-4444-4444-8444-444444444444',
  CONFIRMATION_ACTIVE_DISPUTE_ORDER_ID:
    '55555555-5555-4555-8555-555555555555',
  CONFIRMATION_ACTIVE_DISPUTE_SHIPMENT_ID:
    '66666666-6666-4666-8666-666666666666',
};

describe('deployed confirmation harness configuration', () => {
  it('requires explicit disposable-fixture approval before any request can run', () => {
    expect(() =>
      parseConfirmationHarnessConfig({
        ...fixtureEnvironment,
        CONFIRMATION_HARNESS_APPROVAL: undefined,
      }),
    ).toThrow(
      new HarnessValidationError(
        'Set CONFIRMATION_HARNESS_APPROVAL=I_CONFIRM_DISPOSABLE_FIXTURES before sending any request',
      ),
    );
  });

  it('rejects unsafe or incorrectly targeted function endpoints', () => {
    for (const endpoint of [
      'http://example.test/functions/v1/confirm-shipment-delivery',
      'https://user:password@example.test/functions/v1/confirm-shipment-delivery',
      'https://example.test/functions/v1/confirm-shipment-delivery?unexpected=value',
      'https://example.test/functions/v1/confirm-shipment-delivery#fragment',
      'https://example.test/functions/v1/another-function',
    ]) {
      expect(() =>
        parseConfirmationHarnessConfig({
          ...fixtureEnvironment,
          CONFIRM_SHIPMENT_DELIVERY_URL: endpoint,
        }),
      ).toThrow(HarnessValidationError);
    }
  });

  it('rejects missing required values, malformed fixture IDs, and reused shipments', () => {
    expect(() =>
      parseConfirmationHarnessConfig({
        ...fixtureEnvironment,
        CONFIRM_SHIPMENT_DELIVERY_BEARER_TOKEN: ' ',
      }),
    ).toThrow(
      new HarnessValidationError(
        'Missing required environment variable: CONFIRM_SHIPMENT_DELIVERY_BEARER_TOKEN',
      ),
    );
    expect(() =>
      parseConfirmationHarnessConfig({
        ...fixtureEnvironment,
        CONFIRMATION_SHIPPED_SHIPMENT_ID: undefined,
      }),
    ).toThrow(
      new HarnessValidationError(
        'Missing required environment variable: CONFIRMATION_SHIPPED_SHIPMENT_ID',
      ),
    );
    expect(() =>
      parseConfirmationHarnessConfig({
        ...fixtureEnvironment,
        CONFIRMATION_SHIPPED_ORDER_ID: 'not-a-uuid',
      }),
    ).toThrow(HarnessValidationError);
    expect(() =>
      parseConfirmationHarnessConfig({
        ...fixtureEnvironment,
        CONFIRMATION_ACTIVE_DISPUTE_SHIPMENT_ID:
          fixtureEnvironment.CONFIRMATION_DELIVERED_SHIPMENT_ID,
      }),
    ).toThrow(
      new HarnessValidationError(
        'Each scenario must use a different shipment fixture',
      ),
    );
  });
});

describe('deployed confirmation harness assertions', () => {
  it('issues the four required requests in safe order and accepts their contract responses', async () => {
    const config = parseConfirmationHarnessConfig(fixtureEnvironment);
    const requests: Array<{ body: Record<string, string>; init?: RequestInit }> =
      [];
    const responses = [
      {
        status: 409,
        body: { success: false, error: 'SHIPMENT_NOT_IN_CONFIRMABLE_STATE' },
      },
      {
        status: 409,
        body: { success: false, error: 'SHIPMENT_HAS_ACTIVE_DISPUTE' },
      },
      {
        status: 200,
        body: {
          success: true,
          shipmentId: config.delivered.shipmentId,
          status: 'completed',
          completionSource: 'buyer',
          idempotent: false,
        },
      },
      {
        status: 200,
        body: {
          success: true,
          shipmentId: config.delivered.shipmentId,
          status: 'completed',
          completionSource: 'buyer',
          idempotent: true,
        },
      },
    ];
    const reports: string[] = [];

    await runConfirmationHarness(
      config,
      async (_url, init) => {
        requests.push({ body: JSON.parse(init?.body as string), init });
        const response = responses.shift();
        if (!response) throw new Error('Unexpected request');
        return new Response(JSON.stringify(response.body), { status: response.status });
      },
      (message) => reports.push(message),
    );

    expect(requests.map((request) => request.body.shipmentId)).toEqual([
      config.shipped.shipmentId,
      config.activeDispute.shipmentId,
      config.delivered.shipmentId,
      config.delivered.shipmentId,
    ]);
    expect(requests[2].body.idempotencyKey).toBe(
      `confirm_shipment_${config.delivered.shipmentId}`,
    );
    expect(requests[0].init?.redirect).toBe('error');
    expect(reports).toEqual([
      'PASS shipped rejection',
      'PASS active-dispute rejection',
      'PASS delivered confirmation',
      'PASS idempotent retry',
    ]);
  });

  it('stops before the mutating delivered request when a rejection assertion fails', async () => {
    const config = parseConfirmationHarnessConfig(fixtureEnvironment);
    let requestCount = 0;
    const fetchImpl = async () => {
      requestCount += 1;
      return new Response(
        JSON.stringify({ success: false, error: 'INTERNAL_ERROR' }),
        { status: 500 },
      );
    };

    await expect(runConfirmationHarness(config, fetchImpl)).rejects.toThrow(
      new HarnessAssertionError(
        'Shipped fixture did not return the expected 409 SHIPMENT_NOT_IN_CONFIRMABLE_STATE rejection',
      ),
    );
    expect(requestCount).toBe(1);
  });
});
