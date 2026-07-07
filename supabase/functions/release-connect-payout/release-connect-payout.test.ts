import { describe, expect, it } from 'bun:test';

import {
  ConnectPayoutReleaseError,
  isDefinitiveStripePayoutCreateFailure,
  parseReleaseRequestBody,
  getStripeBalanceInsufficientLogMeta,
  releaseConnectPayout,
  sumAvailableBalanceForCurrency,
  type ConnectPayoutReleaseDependencies,
  type ReleaseQueueRow,
} from './release-connect-payout';

const completedShipment = (
  overrides: Partial<ReleaseQueueRow> = {},
): ReleaseQueueRow => ({
  shipment_id: 'shipment-1',
  seller_id: 'seller-1',
  status: 'completed',
  completed_at: '2026-06-21T12:00:00.000Z',
  is_eligible: true,
  ineligible_reason: null,
  order_id: 'order-1',
  release_amount_cents: 12_500,
  stripe_account_id: 'acct_seller_1',
  stripe_onboarding_status: 'complete',
  stripe_transfer_id: null,
  ...overrides,
});

function createDeps(overrides: Partial<ConnectPayoutReleaseDependencies> = {}) {
  const calls = {
    createdRuns: [] as unknown[],
    mappings: [] as unknown[],
    transfers: [] as unknown[],
    transferUpdates: [] as unknown[],
    payouts: [] as unknown[],
    retries: [] as unknown[],
    payoutFailures: [] as unknown[],
    ambiguousFailures: [] as unknown[],
    balanceRetrievals: [] as unknown[],
    updates: [] as unknown[],
    syncFailures: [] as unknown[],
    sequence: [] as string[],
  };

  const deps: ConnectPayoutReleaseDependencies & { calls: typeof calls } = {
    calls,
    getActorProfile: async () => ({ role: 'admin' }),
    findRunByIdempotencyKey: async () => null,
    findActiveShipmentMappings: async () => [],
    loadReleaseRows: async () => [completedShipment()],
    createRun: async (input) => {
      calls.sequence.push('createRun');
      calls.createdRuns.push(input);
      return { id: 'run-1', ...input };
    },
    createRunShipments: async (input) => {
      calls.sequence.push('createRunShipments');
      calls.mappings.push(input);
    },
    loadReleaseOrders: async () => [
      {
        id: 'order-1',
        stripe_charge_id: null,
        stripe_transfer_group: null,
      },
    ],
    createStripeTransfer: async (input) => {
      calls.sequence.push('createStripeTransfer');
      calls.transfers.push(input);
      return { id: 'tr_123' };
    },
    markShipmentStripeTransferId: async (input) => {
      calls.transferUpdates.push(input);
    },
    retrieveConnectedBalance: async (input) => {
      calls.sequence.push('retrieveConnectedBalance');
      calls.balanceRetrievals.push(input);
      return { available: [{ amount: 99_999, currency: 'mxn' }] };
    },
    createStripePayout: async (input) => {
      calls.sequence.push('createStripePayout');
      calls.payouts.push(input);
      return { id: 'po_123' };
    },
    markRunRetrying: async (input) => {
      calls.retries.push(input);
    },
    markRunStripePayoutFailed: async (input) => {
      calls.payoutFailures.push(input);
    },
    markRunStripePayoutAmbiguous: async (input) => {
      calls.ambiguousFailures.push(input);
    },
    markRunPendingReconciliation: async (input) => {
      calls.updates.push(input);
    },
    markRunPayoutSyncFailed: async (input) => {
      calls.syncFailures.push(input);
    },
    ...overrides,
  };

  return deps;
}

describe('releaseConnectPayout', () => {
  it('sums available balance entries for the payout currency only', () => {
    expect(
      sumAvailableBalanceForCurrency(
        [
          { amount: 7_500, currency: 'mxn' },
          { amount: 2_500, currency: 'mxn' },
          { amount: 99_999, currency: 'usd' },
        ],
        'mxn',
      ),
    ).toBe(10_000);

    expect(
      sumAvailableBalanceForCurrency([{ amount: 99_999, currency: 'usd' }], 'mxn'),
    ).toBe(0);
  });

  it('classifies only Stripe 4xx non-idempotency payout create errors as definitive', () => {
    expect(
      isDefinitiveStripePayoutCreateFailure(
        Object.assign(new Error('Stripe balance insufficient'), {
          type: 'StripeInvalidRequestError',
          statusCode: 400,
          code: 'balance_insufficient',
        }),
      ),
    ).toBe(true);

    expect(
      isDefinitiveStripePayoutCreateFailure(
        Object.assign(new Error('Connection timed out'), {
          type: 'StripeConnectionError',
        }),
      ),
    ).toBe(false);
    expect(
      isDefinitiveStripePayoutCreateFailure(
        Object.assign(new Error('Stripe API unavailable'), {
          type: 'StripeAPIError',
          statusCode: 500,
        }),
      ),
    ).toBe(false);
    expect(
      isDefinitiveStripePayoutCreateFailure(
        Object.assign(new Error('Idempotency conflict'), {
          type: 'StripeIdempotencyError',
          statusCode: 400,
          code: 'idempotency_error',
        }),
      ),
    ).toBe(false);
    expect(isDefinitiveStripePayoutCreateFailure(new Error('Unknown'))).toBe(
      false,
    );
  });

  it('rejects invalid request shapes before orchestration', () => {
    expect(() =>
      parseReleaseRequestBody({
        sellerId: '',
        shipmentIds: ['shipment-1'],
        idempotencyKey: 'release-key-1',
      }),
    ).toThrow('SELLER_ID_REQUIRED');
    expect(() =>
      parseReleaseRequestBody({
        sellerId: 'seller-1',
        shipmentIds: [],
        idempotencyKey: 'release-key-1',
      }),
    ).toThrow('SHIPMENTS_REQUIRED');
  });

  it('rejects non-admin callers before loading shipments', async () => {
    let loadedShipments = false;
    const deps = createDeps({
      getActorProfile: async () => ({ role: 'user' }),
      loadReleaseRows: async () => {
        loadedShipments = true;
        return [completedShipment()];
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'user-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-1',
        },
        deps,
      ),
    ).rejects.toEqual(new ConnectPayoutReleaseError('ADMIN_REQUIRED', 403));
    expect(loadedShipments).toBe(false);
  });

  it('reuses an existing idempotency run without creating another Stripe payout', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({
        id: 'run-existing',
        seller_id: 'seller-1',
        shipment_ids: ['shipment-1'],
        amount: 12_500,
        status: 'pending_reconciliation',
        stripe_payout_id: 'po_existing',
      }),
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-1',
        },
        deps,
      ),
    ).resolves.toEqual({
      success: true,
      runId: 'run-existing',
      stripePayoutId: 'po_existing',
      status: 'pending_reconciliation',
      amount: 12_500,
    });
    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.createdRuns).toEqual([]);
  });

  it('creates one transfer per shipment using the order charge and transfer group before payout', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          shipment_id: 'shipment-1',
          order_id: 'order-1',
          stripe_transfer_id: null,
        }),
      ],
      loadReleaseOrders: async () => [
        {
          id: 'order-1',
          stripe_charge_id: 'ch_123',
          stripe_transfer_group: 'selene_order_order-1',
        },
      ],
      createStripeTransfer: async (input) => {
        deps.calls.sequence.push('createStripeTransfer');
        deps.calls.transfers.push(input);
        return { id: 'tr_shipment_1' };
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-transfer',
        },
        deps,
      ),
    ).resolves.toEqual({
      success: true,
      runId: 'run-1',
      stripePayoutId: 'po_123',
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.transfers).toEqual([
      {
        stripeAccountId: 'acct_seller_1',
        amount: 12_500,
        currency: 'mxn',
        sourceTransaction: 'ch_123',
        transferGroup: 'selene_order_order-1',
        idempotencyKey: 'release-key-transfer:run-1:shipment-1',
        metadata: {
          app_name: 'selene',
          run_id: 'run-1',
          shipment_id: 'shipment-1',
          seller_id: 'seller-1',
          order_id: 'order-1',
        },
      },
    ]);
    expect(deps.calls.transferUpdates).toEqual([
      { shipmentId: 'shipment-1', stripeTransferId: 'tr_shipment_1' },
    ]);
    expect(deps.calls.sequence.indexOf('createStripeTransfer')).toBeLessThan(
      deps.calls.sequence.indexOf('createStripePayout'),
    );
  });

  it('retries a single-modal release after shipment transfer persistence fails without manual DB repair', async () => {
    let firstTransferWrite = true;
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          shipment_id: 'shipment-1',
          order_id: 'order-1',
          stripe_transfer_id: null,
        }),
      ],
      loadReleaseOrders: async () => [
        {
          id: 'order-1',
          stripe_charge_id: 'ch_123',
          stripe_transfer_group: 'selene_order_order-1',
        },
      ],
      markShipmentStripeTransferId: async (input) => {
        deps.calls.transferUpdates.push(input);
        if (firstTransferWrite) {
          firstTransferWrite = false;
          throw new ConnectPayoutReleaseError('SHIPMENT_TRANSFER_UPDATE_FAILED', 500);
        }
      },
      findRunByIdempotencyKey: async (idempotencyKey) => {
        if (idempotencyKey !== 'release-key-transfer-retry') return null;

        return {
          id: 'run-1',
          seller_id: 'seller-1',
          shipment_ids: ['shipment-1'],
          amount: 12_500,
          status: 'pending_reconciliation',
          stripe_payout_id: null,
        };
      },
      findActiveShipmentMappings: async () => [
        { shipmentId: 'shipment-1', runId: 'run-1', status: 'pending_reconciliation' },
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-transfer-retry',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('SHIPMENT_TRANSFER_UPDATE_FAILED', 500),
    );

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-transfer-retry',
        },
        deps,
      ),
    ).resolves.toEqual({
      success: true,
      runId: 'run-1',
      stripePayoutId: 'po_123',
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.transfers).toHaveLength(2);
    expect(deps.calls.transferUpdates).toEqual([
      { shipmentId: 'shipment-1', stripeTransferId: 'tr_123' },
      { shipmentId: 'shipment-1', stripeTransferId: 'tr_123' },
    ]);
    expect(deps.calls.retries).toEqual([{ runId: 'run-1' }, { runId: 'run-1' }]);
  });

  it('reuses an existing shipment transfer and skips transfer creation on retry', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          shipment_id: 'shipment-1',
          order_id: 'order-1',
          stripe_transfer_id: 'tr_existing',
        }),
      ],
      loadReleaseOrders: async () => [
        {
          id: 'order-1',
          stripe_charge_id: 'ch_123',
          stripe_transfer_group: 'selene_order_order-1',
        },
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-existing-transfer',
        },
        deps,
      ),
    ).resolves.toMatchObject({
      success: true,
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.transfers).toEqual([]);
    expect(deps.calls.transferUpdates).toEqual([]);
  });

  it('preserves the legacy payout path when transfer_group is missing', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          shipment_id: 'shipment-1',
          order_id: 'order-legacy',
          stripe_transfer_id: null,
        }),
      ],
      loadReleaseOrders: async () => [
        {
          id: 'order-legacy',
          stripe_charge_id: null,
          stripe_transfer_group: null,
        },
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-legacy',
        },
        deps,
      ),
    ).resolves.toMatchObject({
      success: true,
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.transfers).toEqual([]);
    expect(deps.calls.payouts).toHaveLength(1);
  });

  it('marks pending reconciliation when payout timing cannot be completed after transfer', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          shipment_id: 'shipment-1',
          order_id: 'order-1',
          stripe_transfer_id: null,
        }),
      ],
      loadReleaseOrders: async () => [
        {
          id: 'order-1',
          stripe_charge_id: 'ch_123',
          stripe_transfer_group: 'selene_order_order-1',
        },
      ],
      retrieveConnectedBalance: async (input) => {
        deps.calls.sequence.push('retrieveConnectedBalance');
        deps.calls.balanceRetrievals.push(input);
        return { available: [{ amount: 0, currency: 'mxn' }] };
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-reconcile',
        },
        deps,
      ),
    ).resolves.toMatchObject({
      success: true,
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.transfers).toHaveLength(1);
    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.updates).toEqual([{ runId: 'run-1' }]);
  });

  it('rejects single-modal settlement rows without a charge id when a transfer group exists', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          shipment_id: 'shipment-1',
          order_id: 'order-1',
          stripe_transfer_id: null,
        }),
      ],
      loadReleaseOrders: async () => [
        {
          id: 'order-1',
          stripe_charge_id: null,
          stripe_transfer_group: 'selene_order_order-1',
        },
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-missing-charge',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('MISSING_SETTLEMENT_CONTEXT', 400),
    );

    expect(deps.calls.transfers).toEqual([]);
    expect(deps.calls.payouts).toEqual([]);
  });

  it('rejects reused idempotency keys when the request payload differs', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({
        id: 'run-existing',
        seller_id: 'seller-1',
        shipment_ids: ['shipment-1'],
        amount: 12_500,
        status: 'pending_reconciliation',
        stripe_payout_id: 'po_existing',
      }),
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-2',
          shipmentIds: ['shipment-2'],
          idempotencyKey: 'release-key-1',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('IDEMPOTENCY_KEY_CONFLICT', 409),
    );
    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.createdRuns).toEqual([]);
  });

  it('blocks shipments with active pending, reconciliation-needed, or paid release mappings before Stripe payout', async () => {
    const activeStatuses = [
      'pending_reconciliation',
      'reconciliation_needed',
      'paid',
    ] as const;

    for (const status of activeStatuses) {
      const deps = createDeps({
        findActiveShipmentMappings: async () => [
          { shipmentId: 'shipment-1', runId: `run-${status}`, status },
        ],
      });

      await expect(
        releaseConnectPayout(
          {
            actorId: 'admin-1',
            sellerId: 'seller-1',
            shipmentIds: ['shipment-1'],
            idempotencyKey: `release-key-${status}`,
          },
          deps,
        ),
      ).rejects.toEqual(
        new ConnectPayoutReleaseError('PAYOUT_RELEASE_ALREADY_ACTIVE', 409),
      );
      expect(deps.calls.payouts).toEqual([]);
      expect(deps.calls.createdRuns).toEqual([]);
    }
  });

  it('rejects mixed sellers and ineligible shipments without persisting a run', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({ shipment_id: 'shipment-1' }),
        completedShipment({
          shipment_id: 'shipment-2',
          seller_id: 'seller-2',
          is_eligible: false,
          ineligible_reason: 'active_dispute',
        }),
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1', 'shipment-2'],
          idempotencyKey: 'release-key-2',
        },
        deps,
      ),
    ).rejects.toEqual(new ConnectPayoutReleaseError('MIXED_SELLERS', 400));
    expect(deps.calls.createdRuns).toEqual([]);
  });

  it('rejects active dispute ineligible rows without creating a Stripe payout', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          is_eligible: false,
          ineligible_reason: 'active_dispute',
        }),
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-active-dispute',
        },
        deps,
      ),
    ).rejects.toEqual(new ConnectPayoutReleaseError('active_dispute', 400));
    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.createdRuns).toEqual([]);
  });

  it('rejects non-completed shipments and inactive Connect accounts before Stripe', async () => {
    const notCompletedDeps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({ status: 'delivered', completed_at: null }),
      ],
    });
    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-2a',
        },
        notCompletedDeps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('SHIPMENT_NOT_COMPLETED', 400),
    );
    expect(notCompletedDeps.calls.payouts).toEqual([]);

    const inactiveConnectDeps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({ stripe_onboarding_status: 'pending' }),
      ],
    });
    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-2b',
        },
        inactiveConnectDeps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('CONNECT_ACCOUNT_NOT_READY', 400),
    );
    expect(inactiveConnectDeps.calls.payouts).toEqual([]);
  });

  it('computes batch amount from selected shipments, persists run mappings, then creates Stripe payout', async () => {
    const deps = createDeps({
      loadReleaseRows: async () => [
        completedShipment({
          shipment_id: 'shipment-1',
          release_amount_cents: 12_500,
        }),
        completedShipment({
          shipment_id: 'shipment-2',
          release_amount_cents: 7_500,
        }),
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1', 'shipment-2'],
          idempotencyKey: 'release-key-3',
        },
        deps,
      ),
    ).resolves.toEqual({
      success: true,
      runId: 'run-1',
      stripePayoutId: 'po_123',
      status: 'pending_reconciliation',
      amount: 20_000,
    });
    expect(deps.calls.createdRuns).toEqual([
      {
        actorId: 'admin-1',
        sellerId: 'seller-1',
        amount: 20_000,
        idempotencyKey: 'release-key-3',
      },
    ]);
    expect(deps.calls.mappings).toEqual([
      {
        runId: 'run-1',
        shipments: [
          { shipmentId: 'shipment-1', netPayout: 12_500 },
          { shipmentId: 'shipment-2', netPayout: 7_500 },
        ],
      },
    ]);
    expect(deps.calls.payouts).toEqual([
      {
        stripeAccountId: 'acct_seller_1',
        amount: 20_000,
        currency: 'mxn',
        idempotencyKey: 'release-key-3',
        metadata: {
          app_name: 'selene',
          run_id: 'run-1',
          seller_id: 'seller-1',
          shipment_ids: 'shipment-1,shipment-2',
        },
        orderIds: ['order-1', 'order-1'],
      },
    ]);
    expect(deps.calls.updates).toEqual([
      { runId: 'run-1', stripePayoutId: 'po_123' },
    ]);
  });

  it('blocks insufficient connected-account balance before persisting run or payout writes', async () => {
    const deps = createDeps({
      retrieveConnectedBalance: async (input) => {
        deps.calls.sequence.push('retrieveConnectedBalance');
        deps.calls.balanceRetrievals.push(input);
        return { available: [{ amount: 7_500, currency: 'mxn' }] };
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-insufficient-balance',
        },
        deps,
      ),
    ).resolves.toEqual({
      success: false,
      error: 'Connected account available balance is insufficient for this payout.',
      code: 'stripe_balance_insufficient',
      retryable: true,
      required_amount_cents: 12_500,
      available_amount_cents: 7_500,
      currency: 'mxn',
    });

    expect(deps.calls.balanceRetrievals).toEqual([
      { stripeAccountId: 'acct_seller_1' },
    ]);
    expect(deps.calls.createdRuns).toEqual([]);
    expect(deps.calls.mappings).toEqual([]);
    expect(deps.calls.payouts).toEqual([]);
  });

  it('formats insufficient-balance observability metadata with the response field names', () => {
    expect(
      getStripeBalanceInsufficientLogMeta({
        sellerId: 'seller-1',
        shipmentCount: 2,
        response: {
          success: false,
          error: 'Connected account available balance is insufficient for this payout.',
          code: 'stripe_balance_insufficient',
          retryable: true,
          required_amount_cents: 12_500,
          available_amount_cents: 7_500,
          currency: 'mxn',
        },
      }),
    ).toEqual({
      sellerId: 'seller-1',
      shipmentCount: 2,
      code: 'stripe_balance_insufficient',
      required_amount_cents: 12_500,
      available_amount_cents: 7_500,
      currency: 'mxn',
      retryable: true,
    });
  });

  it('treats missing payout currency as insufficient connected balance', async () => {
    const deps = createDeps({
      retrieveConnectedBalance: async (input) => {
        deps.calls.sequence.push('retrieveConnectedBalance');
        deps.calls.balanceRetrievals.push(input);
        return { available: [{ amount: 99_999, currency: 'usd' }] };
      },
    });

    const result = await releaseConnectPayout(
      {
        actorId: 'admin-1',
        sellerId: 'seller-1',
        shipmentIds: ['shipment-1'],
        idempotencyKey: 'release-key-missing-currency',
      },
      deps,
    );

    expect(result).toMatchObject({
      success: false,
      code: 'stripe_balance_insufficient',
      required_amount_cents: 12_500,
      available_amount_cents: 0,
      currency: 'mxn',
    });
    expect(deps.calls.createdRuns).toEqual([]);
    expect(deps.calls.payouts).toEqual([]);
  });

  it('retrieves connected balance before creating run, mappings, and Stripe payout when funds are sufficient', async () => {
    const deps = createDeps({
      retrieveConnectedBalance: async (input) => {
        deps.calls.sequence.push('retrieveConnectedBalance');
        deps.calls.balanceRetrievals.push(input);
        return {
          available: [
            { amount: 8_000, currency: 'mxn' },
            { amount: 6_000, currency: 'mxn' },
          ],
        };
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-sufficient-balance',
        },
        deps,
      ),
    ).resolves.toMatchObject({ success: true, runId: 'run-1' });

    expect(deps.calls.sequence.slice(0, 4)).toEqual([
      'retrieveConnectedBalance',
      'createRun',
      'createRunShipments',
      'createStripePayout',
    ]);
    expect(deps.calls.balanceRetrievals).toEqual([
      { stripeAccountId: 'acct_seller_1' },
    ]);
  });

  it('marks a recoverable reconciliation state when Stripe payout succeeds but storing the payout id fails', async () => {
    const deps = createDeps({
      markRunPendingReconciliation: async (input) => {
        deps.calls.updates.push(input);
        throw new ConnectPayoutReleaseError('RUN_UPDATE_FAILED', 500);
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-sync-failure',
        },
        deps,
      ),
    ).rejects.toEqual(new ConnectPayoutReleaseError('RUN_UPDATE_FAILED', 500));

    expect(deps.calls.payouts).toEqual([
      {
        stripeAccountId: 'acct_seller_1',
        amount: 12_500,
        currency: 'mxn',
        idempotencyKey: 'release-key-sync-failure',
        metadata: {
          app_name: 'selene',
          run_id: 'run-1',
          seller_id: 'seller-1',
          shipment_ids: 'shipment-1',
        },
        orderIds: ['order-1'],
      },
    ]);
    expect(deps.calls.syncFailures).toEqual([
      {
        runId: 'run-1',
        stripePayoutId: 'po_123',
        failureReason: 'RUN_UPDATE_FAILED',
      },
    ]);
  });

  it('marks the run and mappings failed when Stripe definitively rejects the payout before returning a payout id', async () => {
    const stripeError = Object.assign(
      new Error('Stripe balance insufficient'),
      {
        type: 'StripeInvalidRequestError',
        statusCode: 400,
        code: 'balance_insufficient',
      },
    );
    const deps = createDeps({
      createStripePayout: async (input) => {
        deps.calls.payouts.push(input);
        throw stripeError;
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-stripe-failure',
        },
        deps,
      ),
    ).rejects.toBe(stripeError);

    expect(deps.calls.payoutFailures).toEqual([
      {
        runId: 'run-1',
        failureReason: 'Stripe balance insufficient',
      },
    ]);
    expect(deps.calls.ambiguousFailures).toEqual([]);
  });

  it('keeps ambiguous Stripe create failures active so a new idempotency key cannot duplicate the payout', async () => {
    const stripeError = Object.assign(new Error('Connection timed out'), {
      type: 'StripeConnectionError',
    });
    const activeMappings: Array<{
      shipmentId: string;
      runId: string;
      status: 'pending_reconciliation' | 'paid' | 'reconciliation_needed';
    }> = [];
    const deps = createDeps({
      findActiveShipmentMappings: async (shipmentIds) =>
        activeMappings.filter((mapping) =>
          shipmentIds.includes(mapping.shipmentId),
        ),
      createRunShipments: async (input) => {
        deps.calls.mappings.push(input);
        for (const shipment of input.shipments) {
          activeMappings.push({
            shipmentId: shipment.shipmentId,
            runId: input.runId,
            status: 'pending_reconciliation',
          });
        }
      },
      createStripePayout: async (input) => {
        deps.calls.payouts.push(input);
        throw stripeError;
      },
      markRunStripePayoutAmbiguous: async (input) => {
        deps.calls.ambiguousFailures.push(input);
        for (const mapping of activeMappings) {
          if (mapping.runId === input.runId) {
            mapping.status = 'reconciliation_needed';
          }
        }
      },
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-ambiguous-original',
        },
        deps,
      ),
    ).rejects.toBe(stripeError);

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-ambiguous-new',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('PAYOUT_RELEASE_ALREADY_ACTIVE', 409),
    );

    expect(deps.calls.payouts).toHaveLength(1);
    expect(deps.calls.payoutFailures).toEqual([]);
    expect(deps.calls.ambiguousFailures).toEqual([
      { runId: 'run-1', failureReason: 'Connection timed out' },
    ]);
  });

  it('blocks a same-key retry after an ambiguous create failure without calling Stripe again', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({
        id: 'run-ambiguous',
        seller_id: 'seller-1',
        shipment_ids: ['shipment-1'],
        amount: 12_500,
        status: 'reconciliation_needed',
        stripe_payout_id: null,
      }),
      findActiveShipmentMappings: async () => [
        {
          shipmentId: 'shipment-1',
          runId: 'run-ambiguous',
          status: 'reconciliation_needed',
        },
      ],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-ambiguous-original',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError(
        'PAYOUT_RELEASE_RECONCILIATION_REQUIRED',
        409,
      ),
    );

    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.retries).toEqual([]);
  });

  it('retries a failed pre-Stripe run with the same idempotency key without creating a new run', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({
        id: 'run-failed',
        seller_id: 'seller-1',
        shipment_ids: ['shipment-1'],
        amount: 12_500,
        status: 'failed',
        stripe_payout_id: null,
      }),
      findActiveShipmentMappings: async () => [],
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-stripe-failure',
        },
        deps,
      ),
    ).resolves.toEqual({
      success: true,
      runId: 'run-failed',
      stripePayoutId: 'po_123',
      status: 'pending_reconciliation',
      amount: 12_500,
    });

    expect(deps.calls.createdRuns).toEqual([]);
    expect(deps.calls.mappings).toEqual([]);
    expect(deps.calls.retries).toEqual([{ runId: 'run-failed' }]);
    expect(deps.calls.updates).toEqual([
      { runId: 'run-failed', stripePayoutId: 'po_123' },
    ]);
  });

  it('keeps a truly released run blocked when the failed status has a Stripe payout id', async () => {
    const deps = createDeps({
      findRunByIdempotencyKey: async () => ({
        id: 'run-terminal-failed',
        seller_id: 'seller-1',
        shipment_ids: ['shipment-1'],
        amount: 12_500,
        status: 'failed',
        stripe_payout_id: 'po_failed',
      }),
    });

    await expect(
      releaseConnectPayout(
        {
          actorId: 'admin-1',
          sellerId: 'seller-1',
          shipmentIds: ['shipment-1'],
          idempotencyKey: 'release-key-terminal-failure',
        },
        deps,
      ),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('PAYOUT_RELEASE_PREVIOUSLY_FAILED', 409),
    );

    expect(deps.calls.payouts).toEqual([]);
    expect(deps.calls.createdRuns).toEqual([]);
  });
});
