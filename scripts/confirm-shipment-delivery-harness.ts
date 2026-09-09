const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_APPROVAL = 'I_CONFIRM_DISPOSABLE_FIXTURES';
const FUNCTION_PATH = '/functions/v1/confirm-shipment-delivery';

type HarnessEnvironment = Record<string, string | undefined>;

export type ConfirmationHarnessConfig = {
  endpoint: string;
  buyerAccessToken: string;
  delivered: Fixture;
  shipped: Fixture;
  activeDispute: Fixture;
};

type Fixture = {
  orderId: string;
  shipmentId: string;
};

type ConfirmationResponse = {
  success?: boolean;
  error?: string;
  shipmentId?: string;
  status?: string;
  completionSource?: string;
  idempotent?: boolean;
};

export class HarnessValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessValidationError';
  }
}

export class HarnessAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessAssertionError';
  }
}

function requireEnvironmentValue(
  environment: HarnessEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new HarnessValidationError(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseFixture(
  environment: HarnessEnvironment,
  prefix: string,
): Fixture {
  const orderId = requireEnvironmentValue(environment, `${prefix}_ORDER_ID`);
  const shipmentId = requireEnvironmentValue(
    environment,
    `${prefix}_SHIPMENT_ID`,
  );

  if (!UUID_PATTERN.test(orderId) || !UUID_PATTERN.test(shipmentId)) {
    throw new HarnessValidationError(
      `${prefix}_ORDER_ID and ${prefix}_SHIPMENT_ID must be RFC UUIDs`,
    );
  }

  return { orderId, shipmentId };
}

export function parseConfirmationHarnessConfig(
  environment: HarnessEnvironment,
): ConfirmationHarnessConfig {
  if (environment.CONFIRMATION_HARNESS_APPROVAL !== REQUIRED_APPROVAL) {
    throw new HarnessValidationError(
      'Set CONFIRMATION_HARNESS_APPROVAL=I_CONFIRM_DISPOSABLE_FIXTURES before sending any request',
    );
  }

  const endpoint = requireEnvironmentValue(
    environment,
    'CONFIRM_SHIPMENT_DELIVERY_URL',
  );
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new HarnessValidationError(
      'CONFIRM_SHIPMENT_DELIVERY_URL must be an HTTPS function endpoint',
    );
  }

  if (
    parsedEndpoint.protocol !== 'https:' ||
    parsedEndpoint.username ||
    parsedEndpoint.password ||
    parsedEndpoint.pathname !== FUNCTION_PATH ||
    parsedEndpoint.search ||
    parsedEndpoint.hash
  ) {
    throw new HarnessValidationError(
      `CONFIRM_SHIPMENT_DELIVERY_URL must be an HTTPS URL ending in ${FUNCTION_PATH} without credentials, query, or fragment`,
    );
  }

  const config = {
    endpoint: parsedEndpoint.toString(),
    buyerAccessToken: requireEnvironmentValue(
      environment,
      'CONFIRM_SHIPMENT_DELIVERY_BEARER_TOKEN',
    ),
    delivered: parseFixture(environment, 'CONFIRMATION_DELIVERED'),
    shipped: parseFixture(environment, 'CONFIRMATION_SHIPPED'),
    activeDispute: parseFixture(environment, 'CONFIRMATION_ACTIVE_DISPUTE'),
  };

  const shipmentIds = [
    config.delivered.shipmentId,
    config.shipped.shipmentId,
    config.activeDispute.shipmentId,
  ];
  if (new Set(shipmentIds).size !== shipmentIds.length) {
    throw new HarnessValidationError(
      'Each scenario must use a different shipment fixture',
    );
  }

  return config;
}

async function invokeConfirmation(
  config: ConfirmationHarnessConfig,
  fixture: Fixture,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: ConfirmationResponse }> {
  const response = await fetchImpl(config.endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${config.buyerAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      orderId: fixture.orderId,
      shipmentId: fixture.shipmentId,
      idempotencyKey: `confirm_shipment_${fixture.shipmentId}`,
    }),
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new HarnessAssertionError('Function returned a non-JSON response');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HarnessAssertionError('Function returned an invalid JSON response body');
  }

  return { status: response.status, body: body as ConfirmationResponse };
}

function assertRejected(
  scenario: string,
  response: { status: number; body: ConfirmationResponse },
  expectedError: string,
): void {
  if (response.status !== 409 || response.body.success !== false || response.body.error !== expectedError) {
    throw new HarnessAssertionError(
      `${scenario} did not return the expected 409 ${expectedError} rejection`,
    );
  }
}

function assertSuccess(
  scenario: string,
  response: { status: number; body: ConfirmationResponse },
  shipmentId: string,
  idempotent: boolean,
): void {
  if (
    response.status !== 200 ||
    response.body.success !== true ||
    response.body.shipmentId !== shipmentId ||
    response.body.status !== 'completed' ||
    response.body.completionSource !== 'buyer' ||
    response.body.idempotent !== idempotent
  ) {
    throw new HarnessAssertionError(
      `${scenario} did not return the expected buyer completion response`,
    );
  }
}

export async function runConfirmationHarness(
  config: ConfirmationHarnessConfig,
  fetchImpl: typeof fetch = fetch,
  report: (message: string) => void = console.log,
): Promise<void> {
  assertRejected(
    'Shipped fixture',
    await invokeConfirmation(config, config.shipped, fetchImpl),
    'SHIPMENT_NOT_IN_CONFIRMABLE_STATE',
  );
  report('PASS shipped rejection');

  assertRejected(
    'Active-dispute fixture',
    await invokeConfirmation(config, config.activeDispute, fetchImpl),
    'SHIPMENT_HAS_ACTIVE_DISPUTE',
  );
  report('PASS active-dispute rejection');

  assertSuccess(
    'Delivered fixture',
    await invokeConfirmation(config, config.delivered, fetchImpl),
    config.delivered.shipmentId,
    false,
  );
  report('PASS delivered confirmation');

  assertSuccess(
    'Delivered retry',
    await invokeConfirmation(config, config.delivered, fetchImpl),
    config.delivered.shipmentId,
    true,
  );
  report('PASS idempotent retry');
}

if (import.meta.main) {
  const config = parseConfirmationHarnessConfig(process.env);
  await runConfirmationHarness(config);
}
