import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import {
  createConfirmShipmentDeliveryHandler,
  type SupabaseAdminClient,
} from './handler.ts';
import {
  deriveOrderGroupId,
  deriveShipmentId,
} from '../create-connect-payment/single-payment-builder.ts';

type Row = Record<string, unknown>;

const BUYER_ID = '00000000-0000-4000-8000-0000000000b1';
const ORDER_ID = '00000000-0000-4000-8000-0000000000d1';
const SHIPMENT_ID = '00000000-0000-4000-8000-0000000000c1';
const TOKEN = 'buyer-access-token';

const validBody = {
  orderId: ORDER_ID,
  shipmentId: SHIPMENT_ID,
  idempotencyKey: `confirm_shipment_${SHIPMENT_ID}`,
};

// An in-memory database that applies the PostgREST filters the handler uses, so a test observes
// which rows the handler found and what reached fn_confirm_shipment_delivery. Every table read,
// token check and RPC call is recorded in `calls`.
function fakeDatabase(
  input: {
    users?: Record<string, string>;
    maintenance?: boolean;
    orders?: Row[];
    shipments?: Row[];
    disputes?: Row[];
    rpcResult?: Row;
    rpcError?: boolean;
  } = {},
) {
  const tables: Record<string, Row[]> = {
    system_settings: [{ id: 1, is_maintenance: input.maintenance ?? false }],
    orders: input.orders ?? [{ id: ORDER_ID, buyer_id: BUYER_ID }],
    shipments: input.shipments ?? [
      { id: SHIPMENT_ID, order_id: ORDER_ID, status: 'delivered' },
    ],
    disputes: input.disputes ?? [],
  };
  const users = input.users ?? { [TOKEN]: BUYER_ID };
  const calls: string[] = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];

  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return chain;
      },
      not: (column: string, operator: string, value: string) => {
        if (operator !== 'in') {
          throw new Error(`fake database: unsupported not.${operator}`);
        }
        const list = value.slice(1, -1).split(',');
        rows = rows.filter((row) => !list.includes(String(row[column])));
        return chain;
      },
      single: async () =>
        rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { message: 'not exactly one row' } },
      maybeSingle: async () =>
        rows.length > 1
          ? { data: null, error: { message: 'more than one row' } }
          : { data: rows[0] ?? null, error: null },
    };
    return chain;
  };

  const client = {
    auth: {
      getUser: async (token: string) => {
        calls.push(`auth:${token}`);
        const id = users[token];
        return id
          ? { data: { user: { id } }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT' } };
      },
    },
    from: (table: string) => {
      calls.push(`from:${table}`);
      return query(table);
    },
    rpc: async (name: string, args: Row) => {
      calls.push(`rpc:${name}`);
      rpcCalls.push({ name, args });
      if (input.rpcError) {
        return { data: null, error: { message: 'rpc failed' } };
      }
      return {
        data: [
          input.rpcResult ?? {
            success: true,
            error: null,
            completion_source: 'buyer',
            idempotent: false,
          },
        ],
        error: null,
      };
    },
  };

  return { client: client as unknown as SupabaseAdminClient, calls, rpcCalls };
}

function harness(database = fakeDatabase()) {
  let clientsCreated = 0;
  const handler = createConfirmShipmentDeliveryHandler({
    createSupabaseAdmin: () => {
      clientsCreated += 1;
      return database.client;
    },
  });
  return {
    handler,
    calls: database.calls,
    rpcCalls: database.rpcCalls,
    clientsCreated: () => clientsCreated,
  };
}

const request = (
  body: unknown = validBody,
  init: { method?: string; authorization?: string | null } = {},
) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const authorization =
    init.authorization === undefined ? `Bearer ${TOKEN}` : init.authorization;
  if (authorization !== null) headers.set('Authorization', authorization);
  const method = init.method ?? 'POST';
  return new Request(
    'https://example.test/functions/v1/confirm-shipment-delivery',
    {
      method,
      headers,
      body:
        method === 'GET'
          ? undefined
          : typeof body === 'string'
            ? body
            : JSON.stringify(body),
    },
  );
};

const expectError = async (
  response: Response,
  status: number,
  error: string,
) => {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ success: false, error });
};

describe('confirm-shipment-delivery handler', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    (console.log as unknown as { mockRestore: () => void }).mockRestore();
  });

  it('answers 401 when the auth server reports an error, even with a user object', async () => {
    const calls: string[] = [];
    const handler = createConfirmShipmentDeliveryHandler({
      createSupabaseAdmin: () =>
        ({
          auth: {
            getUser: async () => ({
              data: { user: { id: BUYER_ID } },
              error: { message: 'jwt expired' },
            }),
          },
          from: (table: string) => {
            calls.push(table);
            throw new Error('read a table');
          },
          rpc: async (name: string) => {
            calls.push(name);
            throw new Error('called rpc');
          },
        }) as never,
    });

    await expectError(await handler(request()), 401, 'AUTH_REQUIRED');
    expect(calls).toEqual([]);
  });

  it('refuses a method other than POST before creating a client', async () => {
    const { handler, clientsCreated } = harness();

    await expectError(
      await handler(request(undefined, { method: 'GET' })),
      400,
      'INVALID_REQUEST',
    );
    expect(clientsCreated()).toBe(0);
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    [
      'an order id with a non-RFC variant',
      { ...validBody, orderId: '11111111-2222-3333-4444-555555555555' },
    ],
    ['an order id that is not a UUID', { ...validBody, orderId: 'order-1' }],
    [
      'a shipment id with version 9',
      {
        ...validBody,
        shipmentId: '00000000-0000-9000-8000-0000000000c1',
        idempotencyKey: 'confirm_shipment_00000000-0000-9000-8000-0000000000c1',
      },
    ],
    ['an unknown key', { ...validBody, amount: 1 }],
    [
      'an idempotency key for another shipment',
      { ...validBody, idempotencyKey: 'confirm_shipment_other' },
    ],
    ['a missing shipment id', { orderId: ORDER_ID }],
  ])(
    'answers 400 INVALID_REQUEST for %s before creating a client',
    async (_case, body) => {
      const { handler, clientsCreated } = harness();

      await expectError(await handler(request(body)), 400, 'INVALID_REQUEST');
      expect(clientsCreated()).toBe(0);
    },
  );

  const producerOrderId = deriveOrderGroupId('confirmation-contract-key');
  const producerShipmentId = deriveShipmentId(
    'confirmation-contract-key',
    'product_gpu',
  );

  it.each([
    [
      'v1',
      '00000000-0000-1000-8000-0000000000d1',
      '00000000-0000-1000-8000-0000000000c1',
    ],
    ['v4', ORDER_ID, SHIPMENT_ID],
    ['v5 (create-connect-payment)', producerOrderId, producerShipmentId],
    [
      'v7',
      '019a6f3e-8c1d-7b2a-9f3e-0000000000d1',
      '019a6f3e-8c1d-7b2a-9f3e-0000000000c1',
    ],
    [
      'v8',
      '00000000-0000-8000-8000-0000000000d1',
      '00000000-0000-8000-8000-0000000000c1',
    ],
  ])(
    'accepts %s ids and confirms through fn_confirm_shipment_delivery',
    async (_case, orderId, shipmentId) => {
      const { handler, rpcCalls } = harness(
        fakeDatabase({
          orders: [{ id: orderId, buyer_id: BUYER_ID }],
          shipments: [
            { id: shipmentId, order_id: orderId, status: 'delivered' },
          ],
        }),
      );

      const response = await handler(
        request({
          orderId,
          shipmentId,
          idempotencyKey: `confirm_shipment_${shipmentId}`,
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        success: true,
        shipmentId,
      });
      expect(rpcCalls).toEqual([
        {
          name: 'fn_confirm_shipment_delivery',
          args: {
            p_shipment_id: shipmentId,
            p_source: 'buyer',
            p_actor_id: BUYER_ID,
            p_idempotency_key: `confirm_shipment_${shipmentId}`,
          },
        },
      ]);
    },
  );

  it.each([
    ['no Authorization header', null],
    ['a token that is not a signed-in user', 'Bearer anon-key'],
  ])(
    'answers 401 AUTH_REQUIRED for %s before reading any table',
    async (_case, authorization) => {
      const { handler, calls } = harness();

      await expectError(
        await handler(request(validBody, { authorization })),
        401,
        'AUTH_REQUIRED',
      );
      expect(calls.filter((call) => !call.startsWith('auth:'))).toEqual([]);
    },
  );

  it('confirms a delivered shipment for its buyer through fn_confirm_shipment_delivery', async () => {
    const { handler, calls, rpcCalls } = harness();

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      shipmentId: SHIPMENT_ID,
      status: 'completed',
      completionSource: 'buyer',
      idempotent: false,
    });
    expect(calls[0]).toBe(`auth:${TOKEN}`);
    expect(rpcCalls).toEqual([
      {
        name: 'fn_confirm_shipment_delivery',
        args: {
          p_shipment_id: SHIPMENT_ID,
          p_source: 'buyer',
          p_actor_id: BUYER_ID,
          p_idempotency_key: `confirm_shipment_${SHIPMENT_ID}`,
        },
      },
    ]);
  });

  it('answers a retry on a completed shipment as idempotent success', async () => {
    const { handler } = harness(
      fakeDatabase({
        shipments: [
          { id: SHIPMENT_ID, order_id: ORDER_ID, status: 'completed' },
        ],
        rpcResult: {
          success: true,
          error: null,
          completion_source: 'buyer',
          idempotent: true,
        },
      }),
    );

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ idempotent: true });
  });

  it.each([
    [
      'maintenance mode',
      fakeDatabase({ maintenance: true }),
      503,
      'MAINTENANCE_MODE',
    ],
    [
      'an unknown order',
      fakeDatabase({ orders: [] }),
      404,
      'SHIPMENT_NOT_FOUND',
    ],
    [
      'a shipment of another order',
      fakeDatabase({
        shipments: [
          {
            id: SHIPMENT_ID,
            order_id: '00000000-0000-4000-8000-0000000000d2',
            status: 'delivered',
          },
        ],
      }),
      404,
      'SHIPMENT_NOT_FOUND',
    ],
    [
      'an order of another buyer',
      fakeDatabase({
        orders: [
          { id: ORDER_ID, buyer_id: '00000000-0000-4000-8000-0000000000b2' },
        ],
      }),
      403,
      'BUYER_REQUIRED',
    ],
    [
      'a shipment that is not delivered yet',
      fakeDatabase({
        shipments: [{ id: SHIPMENT_ID, order_id: ORDER_ID, status: 'shipped' }],
      }),
      409,
      'SHIPMENT_NOT_IN_CONFIRMABLE_STATE',
    ],
    [
      'an open dispute on the shipment',
      fakeDatabase({
        disputes: [
          { id: 'dispute-1', shipment_id: SHIPMENT_ID, status: 'open' },
        ],
      }),
      409,
      'SHIPMENT_HAS_ACTIVE_DISPUTE',
    ],
  ])(
    'refuses %s without calling fn_confirm_shipment_delivery',
    async (_case, database, status, error) => {
      const { handler, rpcCalls } = harness(database);

      await expectError(await handler(request()), status, error);
      expect(rpcCalls).toEqual([]);
    },
  );

  it('ignores a resolved or rejected dispute', async () => {
    const { handler, rpcCalls } = harness(
      fakeDatabase({
        disputes: [
          { id: 'dispute-1', shipment_id: SHIPMENT_ID, status: 'resolved' },
          { id: 'dispute-2', shipment_id: SHIPMENT_ID, status: 'rejected' },
        ],
      }),
    );

    expect((await handler(request())).status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
  });

  it('maps a refusal from fn_confirm_shipment_delivery to its status code', async () => {
    const { handler } = harness(
      fakeDatabase({
        rpcResult: {
          success: false,
          error: 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE',
          completion_source: null,
          idempotent: false,
        },
      }),
    );

    await expectError(
      await handler(request()),
      409,
      'SHIPMENT_CANCELLATION_OPERATION_ACTIVE',
    );
  });

  it('answers 500 INTERNAL_ERROR when fn_confirm_shipment_delivery fails', async () => {
    const { handler } = harness(fakeDatabase({ rpcError: true }));

    await expectError(await handler(request()), 500, 'INTERNAL_ERROR');
  });
});
