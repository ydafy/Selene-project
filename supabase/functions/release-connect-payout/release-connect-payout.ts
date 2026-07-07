export type ConnectPayoutRunStatus =
  | 'pending_reconciliation'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'reconciliation_needed';

export interface ReleaseQueueRow {
  shipment_id: string | null;
  seller_id: string | null;
  order_id: string | null;
  status: string | null;
  completed_at: string | null;
  is_eligible: boolean | null;
  ineligible_reason: string | null;
  release_amount_cents: number | null;
  stripe_account_id: string | null;
  stripe_onboarding_status: string | null;
  stripe_transfer_id: string | null;
}

export interface ReleaseSettlementOrder {
  id: string;
  stripe_charge_id: string | null;
  stripe_transfer_group: string | null;
}

export interface ExistingConnectPayoutRun {
  id: string;
  seller_id: string;
  shipment_ids: string[];
  amount: number;
  status: ConnectPayoutRunStatus;
  stripe_payout_id: string | null;
}

export interface ActiveConnectPayoutRunShipment {
  shipmentId: string;
  runId: string;
  status: Extract<
    ConnectPayoutRunStatus,
    'pending_reconciliation' | 'paid' | 'reconciliation_needed'
  >;
}

export interface CreatedConnectPayoutRun {
  id: string;
}

export interface ConnectedBalanceEntry {
  amount: number;
  currency: string;
}

export interface ConnectedBalancePreflightResult {
  requiredAmountCents: number;
  availableAmountCents: number;
  currency: 'mxn';
  isSufficient: boolean;
}

export interface ConnectPayoutReleaseDependencies {
  getActorProfile: (actorId: string) => Promise<{ role: string | null } | null>;
  findRunByIdempotencyKey: (
    idempotencyKey: string,
  ) => Promise<ExistingConnectPayoutRun | null>;
  findActiveShipmentMappings: (
    shipmentIds: string[],
  ) => Promise<ActiveConnectPayoutRunShipment[]>;
  loadReleaseRows: (shipmentIds: string[]) => Promise<ReleaseQueueRow[]>;
  loadReleaseOrders: (orderIds: string[]) => Promise<ReleaseSettlementOrder[]>;
  createRun: (input: {
    actorId: string;
    sellerId: string;
    amount: number;
    idempotencyKey: string;
  }) => Promise<CreatedConnectPayoutRun>;
  createRunShipments: (input: {
    runId: string;
    shipments: Array<{ shipmentId: string; netPayout: number }>;
  }) => Promise<void>;
  createStripeTransfer: (input: {
    stripeAccountId: string;
    amount: number;
    currency: 'mxn';
    sourceTransaction: string;
    transferGroup: string;
    idempotencyKey: string;
    metadata: {
      app_name: 'selene';
      run_id: string;
      shipment_id: string;
      seller_id: string;
      order_id: string;
    };
  }) => Promise<{ id: string }>;
  markShipmentStripeTransferId: (input: {
    shipmentId: string;
    stripeTransferId: string;
  }) => Promise<void>;
  retrieveConnectedBalance: (input: {
    stripeAccountId: string;
  }) => Promise<{ available: ConnectedBalanceEntry[] }>;
  createStripePayout: (input: {
    stripeAccountId: string;
    amount: number;
    currency: 'mxn';
    idempotencyKey: string;
    metadata: {
      app_name: 'selene';
      run_id: string;
      seller_id: string;
      shipment_ids: string;
    };
    orderIds: string[];
  }) => Promise<{ id: string }>;
  markRunRetrying: (input: { runId: string }) => Promise<void>;
  markRunStripePayoutFailed: (input: {
    runId: string;
    failureReason: string;
  }) => Promise<void>;
  markRunStripePayoutAmbiguous: (input: {
    runId: string;
    failureReason: string;
  }) => Promise<void>;
  markRunPendingReconciliation: (input: {
    runId: string;
    stripePayoutId?: string | null;
  }) => Promise<void>;
  markRunPayoutSyncFailed: (input: {
    runId: string;
    stripePayoutId: string;
    failureReason: string;
  }) => Promise<void>;
}

export type ReleaseConnectPayoutResponse =
  | {
      success: true;
      runId: string;
      stripePayoutId?: string;
      status: ConnectPayoutRunStatus;
      amount: number;
    }
  | {
      success: false;
      error: string;
      code?: 'stripe_balance_insufficient';
      retryable?: boolean;
      required_amount_cents?: number;
      available_amount_cents?: number;
      currency?: 'mxn';
    };

type StripeBalanceInsufficientResponse = Extract<
  ReleaseConnectPayoutResponse,
  { success: false; code?: 'stripe_balance_insufficient' }
>;

export function getStripeBalanceInsufficientLogMeta(input: {
  sellerId: string;
  shipmentCount: number;
  response: StripeBalanceInsufficientResponse;
}): Record<string, unknown> {
  return {
    sellerId: input.sellerId,
    shipmentCount: input.shipmentCount,
    code: input.response.code,
    required_amount_cents: input.response.required_amount_cents,
    available_amount_cents: input.response.available_amount_cents,
    currency: input.response.currency,
    retryable: input.response.retryable,
  };
}

export class ConnectPayoutReleaseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ConnectPayoutReleaseError';
  }
}

export function getConnectPayoutReleaseErrorStatus(message: string): number {
  if (message === 'AUTH_REQUIRED') return 401;
  if (message === 'ADMIN_REQUIRED') return 403;
  if (message === 'MISSING_SERVER_CONFIG') return 500;
  return 400;
}

function assertNonEmptyString(value: unknown, error: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConnectPayoutReleaseError(error, 400);
  }

  return value.trim();
}

export function parseReleaseRequestBody(body: unknown): {
  sellerId: string;
  shipmentIds: string[];
  idempotencyKey: string;
} {
  if (!body || typeof body !== 'object') {
    throw new ConnectPayoutReleaseError('INVALID_REQUEST', 400);
  }

  const record = body as Record<string, unknown>;
  const sellerId = assertNonEmptyString(record.sellerId, 'SELLER_ID_REQUIRED');
  const idempotencyKey = assertNonEmptyString(
    record.idempotencyKey,
    'IDEMPOTENCY_KEY_REQUIRED',
  );

  if (!Array.isArray(record.shipmentIds) || record.shipmentIds.length === 0) {
    throw new ConnectPayoutReleaseError('SHIPMENTS_REQUIRED', 400);
  }

  const shipmentIds = [
    ...new Set(
      record.shipmentIds.map((id) =>
        assertNonEmptyString(id, 'INVALID_SHIPMENT_ID'),
      ),
    ),
  ];
  if (shipmentIds.length === 0) {
    throw new ConnectPayoutReleaseError('SHIPMENTS_REQUIRED', 400);
  }

  return { sellerId, shipmentIds, idempotencyKey };
}

function assertEligibleRows(
  sellerId: string,
  requestedShipmentIds: string[],
  rows: ReleaseQueueRow[],
  options: { allowAlreadyReleased: boolean } = { allowAlreadyReleased: false },
): asserts rows is Array<
  ReleaseQueueRow & {
    shipment_id: string;
    seller_id: string;
    release_amount_cents: number;
    stripe_account_id: string;
  }
> {
  if (rows.length !== requestedShipmentIds.length) {
    throw new ConnectPayoutReleaseError('SHIPMENT_NOT_FOUND', 400);
  }

  const requested = new Set(requestedShipmentIds);
  for (const row of rows) {
    if (!row.shipment_id || !requested.has(row.shipment_id)) {
      throw new ConnectPayoutReleaseError('SHIPMENT_NOT_FOUND', 400);
    }
    if (row.seller_id !== sellerId) {
      throw new ConnectPayoutReleaseError('MIXED_SELLERS', 400);
    }
    if (row.status !== 'completed' || !row.completed_at) {
      throw new ConnectPayoutReleaseError('SHIPMENT_NOT_COMPLETED', 400);
    }
    if (
      row.is_eligible !== true &&
      !(
        options.allowAlreadyReleased &&
        row.ineligible_reason === 'already_released'
      )
    ) {
      throw new ConnectPayoutReleaseError(
        row.ineligible_reason ?? 'SHIPMENT_INELIGIBLE',
        400,
      );
    }
    if (!row.stripe_account_id || row.stripe_onboarding_status !== 'complete') {
      throw new ConnectPayoutReleaseError('CONNECT_ACCOUNT_NOT_READY', 400);
    }
    if (!row.release_amount_cents || row.release_amount_cents <= 0) {
      throw new ConnectPayoutReleaseError('INVALID_RELEASE_AMOUNT', 400);
    }
  }
}

function normalizeShipmentIds(shipmentIds: string[]): string[] {
  return [...new Set(shipmentIds)].sort();
}

function hasEquivalentRequest(
  run: ExistingConnectPayoutRun,
  request: { sellerId: string; shipmentIds: string[] },
): boolean {
  return (
    run.seller_id === request.sellerId &&
    normalizeShipmentIds(run.shipment_ids).join('\0') ===
      normalizeShipmentIds(request.shipmentIds).join('\0')
  );
}

function toFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sumAvailableBalanceForCurrency(
  entries: ConnectedBalanceEntry[],
  currency: 'mxn',
): number {
  return entries.reduce(
    (total, entry) =>
      entry.currency === currency ? total + entry.amount : total,
    0,
  );
}

async function preflightConnectedBalance(input: {
  stripeAccountId: string;
  requiredAmountCents: number;
  currency: 'mxn';
  retrieveConnectedBalance: ConnectPayoutReleaseDependencies['retrieveConnectedBalance'];
}): Promise<ConnectedBalancePreflightResult> {
  const balance = await input.retrieveConnectedBalance({
    stripeAccountId: input.stripeAccountId,
  });
  const availableAmountCents = sumAvailableBalanceForCurrency(
    balance.available,
    input.currency,
  );

  return {
    requiredAmountCents: input.requiredAmountCents,
    availableAmountCents,
    currency: input.currency,
    isSufficient: availableAmountCents >= input.requiredAmountCents,
  };
}

function getStripeErrorField(
  error: unknown,
  field: 'type' | 'code' | 'statusCode',
): unknown {
  if (!error || typeof error !== 'object') return undefined;

  const record = error as Record<string, unknown>;
  const raw =
    record.raw && typeof record.raw === 'object'
      ? (record.raw as Record<string, unknown>)
      : undefined;

  return record[field] ?? raw?.[field];
}

export function isDefinitiveStripePayoutCreateFailure(error: unknown): boolean {
  const type = getStripeErrorField(error, 'type');
  const code = getStripeErrorField(error, 'code');
  const statusCode = getStripeErrorField(error, 'statusCode');

  if (
    type === 'StripeConnectionError' ||
    type === 'StripeAPIError' ||
    type === 'StripeIdempotencyError' ||
    type === 'idempotency_error' ||
    code === 'idempotency_error'
  ) {
    return false;
  }

  if (typeof statusCode !== 'number') return false;
  if (statusCode === 409 || statusCode >= 500) return false;

  return statusCode >= 400 && statusCode < 500;
}

function isRetryableExistingRun(run: ExistingConnectPayoutRun): boolean {
  return (
    run.stripe_payout_id === null &&
    (run.status === 'failed' || run.status === 'pending_reconciliation')
  );
}

function normalizeOrderIds(rows: ReleaseQueueRow[]): string[] {
  return [...new Set(rows.map((row) => row.order_id).filter(Boolean))].filter(
    (orderId): orderId is string => Boolean(orderId),
  );
}

function buildTransferIdempotencyKey(input: {
  idempotencyKey: string;
  runId: string;
  shipmentId: string;
}): string {
  return `${input.idempotencyKey}:${input.runId}:${input.shipmentId}`;
}

export async function releaseConnectPayout(
  input: {
    actorId: string;
    sellerId: string;
    shipmentIds: string[];
    idempotencyKey: string;
  },
  deps: ConnectPayoutReleaseDependencies,
): Promise<ReleaseConnectPayoutResponse> {
  const actor = await deps.getActorProfile(input.actorId);
  if (actor?.role !== 'admin') {
    throw new ConnectPayoutReleaseError('ADMIN_REQUIRED', 403);
  }

  const existingRun = await deps.findRunByIdempotencyKey(input.idempotencyKey);
  const retryRun =
    existingRun && isRetryableExistingRun(existingRun) ? existingRun : null;
  if (existingRun) {
    if (!hasEquivalentRequest(existingRun, input)) {
      throw new ConnectPayoutReleaseError('IDEMPOTENCY_KEY_CONFLICT', 409);
    }

    if (!retryRun) {
      if (
        existingRun.stripe_payout_id === null &&
        (existingRun.status === 'pending_reconciliation' ||
          existingRun.status === 'reconciliation_needed')
      ) {
        throw new ConnectPayoutReleaseError(
          'PAYOUT_RELEASE_RECONCILIATION_REQUIRED',
          409,
        );
      }

      if (existingRun.status === 'failed') {
        throw new ConnectPayoutReleaseError(
          'PAYOUT_RELEASE_PREVIOUSLY_FAILED',
          409,
        );
      }

      return {
        success: true,
        runId: existingRun.id,
        ...(existingRun.stripe_payout_id
          ? { stripePayoutId: existingRun.stripe_payout_id }
          : {}),
        status: existingRun.status,
        amount: existingRun.amount,
      };
    }
  }

  const activeMappings = await deps.findActiveShipmentMappings(
    input.shipmentIds,
  );
  const conflictingActiveMappings = activeMappings.filter(
    (mapping) => mapping.runId !== retryRun?.id,
  );
  if (conflictingActiveMappings.length > 0) {
    throw new ConnectPayoutReleaseError('PAYOUT_RELEASE_ALREADY_ACTIVE', 409);
  }

  const rows = await deps.loadReleaseRows(input.shipmentIds);
  assertEligibleRows(input.sellerId, input.shipmentIds, rows, {
    allowAlreadyReleased: Boolean(retryRun),
  });

  const orderIds = normalizeOrderIds(rows);
  const orders = await deps.loadReleaseOrders(orderIds);
  const orderById = new Map(orders.map((order) => [order.id, order]));
  if (orderIds.some((orderId) => !orderById.has(orderId))) {
    throw new ConnectPayoutReleaseError('MISSING_SETTLEMENT_CONTEXT', 400);
  }

  const hasSingleModalSettlement = orders.some(
    (order) => order.stripe_transfer_group !== null,
  );
  if (
    hasSingleModalSettlement &&
    orders.some(
      (order) =>
        !order.stripe_transfer_group || !order.stripe_charge_id,
    )
  ) {
    throw new ConnectPayoutReleaseError('MISSING_SETTLEMENT_CONTEXT', 400);
  }

  if (!hasSingleModalSettlement) {
    const balancePreflight = await preflightConnectedBalance({
      stripeAccountId: rows[0].stripe_account_id,
      requiredAmountCents: rows.reduce(
        (total, row) => total + (row.release_amount_cents ?? 0),
        0,
      ),
      currency: 'mxn',
      retrieveConnectedBalance: deps.retrieveConnectedBalance,
    });
    if (!balancePreflight.isSufficient) {
      return {
        success: false,
        error: 'Connected account available balance is insufficient for this payout.',
        code: 'stripe_balance_insufficient',
        retryable: true,
        required_amount_cents: balancePreflight.requiredAmountCents,
        available_amount_cents: balancePreflight.availableAmountCents,
        currency: balancePreflight.currency,
      };
    }
  }

  const currentAmount = rows.reduce(
    (total, row) => total + row.release_amount_cents,
    0,
  );
  if (retryRun && currentAmount !== retryRun.amount) {
    throw new ConnectPayoutReleaseError('PAYOUT_RELEASE_AMOUNT_CHANGED', 409);
  }

  const amount = retryRun?.amount ?? currentAmount;

  const run =
    retryRun ??
    (await deps.createRun({
      actorId: input.actorId,
      sellerId: input.sellerId,
      amount,
      idempotencyKey: input.idempotencyKey,
    }));

  if (retryRun) {
    await deps.markRunRetrying({ runId: retryRun.id });
  } else {
    await deps.createRunShipments({
      runId: run.id,
      shipments: rows.map((row) => ({
        shipmentId: row.shipment_id,
        netPayout: row.release_amount_cents,
      })),
    });
  }

  if (hasSingleModalSettlement) {
    for (const row of rows) {
      if (row.stripe_transfer_id) {
        continue;
      }

      const order = row.order_id ? orderById.get(row.order_id) : null;
      if (!order?.stripe_charge_id || !order.stripe_transfer_group) {
        throw new ConnectPayoutReleaseError('MISSING_SETTLEMENT_CONTEXT', 400);
      }

      const transfer = await deps.createStripeTransfer({
        stripeAccountId: row.stripe_account_id,
        amount: row.release_amount_cents,
        currency: 'mxn',
        sourceTransaction: order.stripe_charge_id,
        transferGroup: order.stripe_transfer_group,
        idempotencyKey: buildTransferIdempotencyKey({
          idempotencyKey: input.idempotencyKey,
          runId: run.id,
          shipmentId: row.shipment_id,
        }),
        metadata: {
          app_name: 'selene',
          run_id: run.id,
          shipment_id: row.shipment_id,
          seller_id: input.sellerId,
          order_id: order.id,
        },
      });

      await deps.markShipmentStripeTransferId({
        shipmentId: row.shipment_id,
        stripeTransferId: transfer.id,
      });
    }

    const balancePreflight = await preflightConnectedBalance({
      stripeAccountId: rows[0].stripe_account_id,
      requiredAmountCents: amount,
      currency: 'mxn',
      retrieveConnectedBalance: deps.retrieveConnectedBalance,
    });

    if (!balancePreflight.isSufficient) {
      await deps.markRunPendingReconciliation({ runId: run.id });
      return {
        success: true,
        runId: run.id,
        status: 'pending_reconciliation',
        amount,
      };
    }
  }

  let payout: { id: string };
  try {
    payout = await deps.createStripePayout({
      stripeAccountId: rows[0].stripe_account_id,
      amount,
      currency: 'mxn',
      idempotencyKey: input.idempotencyKey,
      metadata: {
        app_name: 'selene',
        run_id: run.id,
        seller_id: input.sellerId,
        shipment_ids: input.shipmentIds.join(','),
      },
      orderIds: rows
        .map((row) => row.order_id)
        .filter((orderId): orderId is string => Boolean(orderId)),
    });
  } catch (error) {
    try {
      const failureReason = toFailureReason(error);
      if (isDefinitiveStripePayoutCreateFailure(error)) {
        await deps.markRunStripePayoutFailed({
          runId: run.id,
          failureReason,
        });
      } else {
        await deps.markRunStripePayoutAmbiguous({
          runId: run.id,
          failureReason,
        });
      }
    } catch {
      // Preserve the Stripe error. The top-level handler logs it, and the stale
      // pending run keeps the shipments blocked instead of risking duplicates.
    }
    throw error;
  }

  try {
    await deps.markRunPendingReconciliation({
      runId: run.id,
      stripePayoutId: payout.id,
    });
  } catch (error) {
    try {
      await deps.markRunPayoutSyncFailed({
        runId: run.id,
        stripePayoutId: payout.id,
        failureReason: toFailureReason(error),
      });
    } catch {
      // Preserve the original post-Stripe sync error. Webhook metadata still
      // carries the run id and can recover if the failure-state write also
      // could not be persisted.
    }
    throw error;
  }

  return {
    success: true,
    runId: run.id,
    stripePayoutId: payout.id,
    status: 'pending_reconciliation',
    amount,
  };
}
