import { describe, expect, it } from 'bun:test';

import {
  assertValidCheckoutAllocation,
  assertValidConnectMoneyFlow,
  calculateCheckoutAllocation,
  calculateEstimatedSellerShippingDeductionCents,
  calculateConnectMoneyFlow,
  normalizeEnviaInsuranceRate,
} from './fee-calculator.ts';

describe('create-connect-payment fee calculator', () => {
  it('charges the buyer only subtotal plus Seguro Selene', () => {
    const flow = calculateConnectMoneyFlow({
      subtotalCents: 100_000,
      shippingCents: 20_000,
    });

    expect(flow).toEqual({
      subtotalCents: 100_000,
      commissionCents: 6_000,
      shippingCents: 20_000,
      seguroCents: 4_722,
      buyerChargeCents: 104_722,
      applicationFeeCents: 30_722,
      sellerNetCents: 74_000,
    });
  });

  it('excludes seller shipping from the Seguro Selene basis', () => {
    const flow = calculateConnectMoneyFlow({
      subtotalCents: 100_000,
      shippingCents: 50_000,
    });

    expect(flow.seguroCents).toBe(4_722);
    expect(flow.buyerChargeCents).toBe(104_722);
  });

  it('calculates estimate-first seller shipping deduction from quote, buffer, and Envia insurance', () => {
    expect(
      calculateEstimatedSellerShippingDeductionCents({
        priceCents: 800_000,
        quotedShippingCents: 18_600,
        shippingBufferCents: 3_000,
        insuranceRate: 0.012,
      }),
    ).toBe(31_200);
  });

  it('keeps missing quoted shipping at zero so payout release can block it', () => {
    expect(
      calculateEstimatedSellerShippingDeductionCents({
        priceCents: 800_000,
        quotedShippingCents: 0,
      }),
    ).toBe(0);
  });

  it('normalizes Envia insurance settings defensively', () => {
    expect(normalizeEnviaInsuranceRate(0.012)).toBe(0.012);
    expect(normalizeEnviaInsuranceRate(1.2)).toBe(0.012);
    expect(normalizeEnviaInsuranceRate(120)).toBe(0.012);
    expect(normalizeEnviaInsuranceRate(null)).toBe(0);
  });

  it('rejects negative seller economics before creating a PaymentIntent', () => {
    const flow = calculateConnectMoneyFlow({
      subtotalCents: 10_000,
      shippingCents: 20_000,
    });

    expect(() => assertValidConnectMoneyFlow(flow)).toThrow(
      'INVALID_CONNECT_ECONOMICS',
    );
  });
});

describe('create-connect-payment checkout allocation (single-modal)', () => {
  it('produces one AllocationRow per seller with gross, commission, shipping, seguro, net, and the durable shipment id', () => {
    const allocation = calculateCheckoutAllocation([
      {
        sellerId: 'seller-a',
        shipmentId: 'ship-a',
        subtotalCents: 100_000,
        shippingCents: 20_000,
      },
    ]);

    expect(allocation.rows).toHaveLength(1);
    expect(allocation.rows[0]).toEqual({
      sellerId: 'seller-a',
      shipmentId: 'ship-a',
      grossCents: 100_000,
      commissionCents: 6_000,
      shippingCents: 20_000,
      seguroCents: 4_722,
      netCents: 74_000,
    });
  });

  it('keeps the single-seller row consistent with the legacy ConnectMoneyFlow contract', () => {
    const legacy = calculateConnectMoneyFlow({
      subtotalCents: 100_000,
      shippingCents: 20_000,
    });
    const allocation = calculateCheckoutAllocation([
      {
        sellerId: 'seller-a',
        shipmentId: 'ship-a',
        subtotalCents: 100_000,
        shippingCents: 20_000,
      },
    ]);
    const row = allocation.rows[0];

    // The buyer-visible amount for a single-seller checkout equals the legacy
    // buyer charge, and the seller-facing release equals the legacy seller net.
    expect(allocation.buyerTotalCents).toBe(legacy.buyerChargeCents);
    expect(row.netCents).toBe(legacy.sellerNetCents);
    expect(row.commissionCents).toBe(legacy.commissionCents);
    expect(row.seguroCents).toBe(legacy.seguroCents);
  });

  it('reconciles buyer total and seller release across multiple sellers', () => {
    const allocation = calculateCheckoutAllocation([
      {
        sellerId: 'seller-a',
        shipmentId: 'ship-a',
        subtotalCents: 100_000,
        shippingCents: 20_000,
      },
      {
        sellerId: 'seller-b',
        shipmentId: 'ship-b',
        subtotalCents: 50_000,
        shippingCents: 10_000,
      },
    ]);

    expect(allocation.rows).toHaveLength(2);
    expect(allocation.rows[0].sellerId).toBe('seller-a');
    expect(allocation.rows[1].sellerId).toBe('seller-b');

    // Buyer pays one grossed-up total; shipping is seller-paid and invisible
    // to the buyer.
    expect(allocation.buyerTotalCents).toBe(156_901);
    expect(allocation.totalSeguroCents).toBe(6_901);
    expect(allocation.totalShippingCents).toBe(30_000);

    // Sum of seller-facing release amounts equals the total to be transferred
    // later during manual admin release.
    expect(allocation.totalReleaseCents).toBe(111_000);
    expect(allocation.rows[0].seguroCents).toBe(4_601);
    expect(allocation.rows[1].seguroCents).toBe(2_300);
    expect(allocation.rows[0].netCents).toBe(74_000);
    expect(allocation.rows[1].netCents).toBe(37_000);
  });

  it('verifies the buyer total equals gross plus seguro across all sellers', () => {
    const allocation = calculateCheckoutAllocation([
      {
        sellerId: 'seller-a',
        shipmentId: 'ship-a',
        subtotalCents: 100_000,
        shippingCents: 20_000,
      },
      {
        sellerId: 'seller-b',
        shipmentId: 'ship-b',
        subtotalCents: 50_000,
        shippingCents: 10_000,
      },
    ]);

    const grossPlusSeguro =
      allocation.totalGrossCents + allocation.totalSeguroCents;
    expect(allocation.buyerTotalCents).toBe(grossPlusSeguro);
  });

  it('rounds commission down and seguro up without breaking the per-row reconciliation', () => {
    const allocation = calculateCheckoutAllocation([
      // 1_005 * 0.06 = 60.3 -> round to 60 (commission)
      // Gross-up formula returns 407 cents of buyer fee for a 1_005-cent subtotal.
      // net = 1_005 - 60 - 0 = 945
      { sellerId: 'seller-round', shipmentId: 'ship-round', subtotalCents: 1_005, shippingCents: 0 },
    ]);

    const row = allocation.rows[0];
    expect(row.commissionCents).toBe(60);
    expect(row.seguroCents).toBe(407);
    expect(row.netCents).toBe(945);
    expect(allocation.buyerTotalCents).toBe(1_412);

    // Per-row invariant: commission + shipping + net == gross.
    expect(row.commissionCents + row.shippingCents + row.netCents).toBe(
      row.grossCents,
    );
  });

  it('applies a custom platform commission rate per row', () => {
    const allocation = calculateCheckoutAllocation(
      [{ sellerId: 'seller-x', shipmentId: 'ship-x', subtotalCents: 100_000, shippingCents: 0 }],
      { commissionRate: 0.1 },
    );

    expect(allocation.rows[0].commissionCents).toBe(10_000);
    expect(allocation.rows[0].netCents).toBe(90_000);
  });

  it('rejects an empty seller set as an invalid checkout input', () => {
    expect(() => calculateCheckoutAllocation([])).toThrow(
      'INVALID_CHECKOUT_INPUT',
    );
  });

  it('allocates independent shipments and cent-exact seguro to two products from one seller', () => {
    const allocation = calculateCheckoutAllocation([
      {
        sellerId: 'seller-a',
        shipmentId: 'ship-product-a',
        subtotalCents: 100_000,
        shippingCents: 0,
      },
      {
        sellerId: 'seller-a',
        shipmentId: 'ship-product-b',
        subtotalCents: 50_000,
        shippingCents: 0,
      },
    ]);

    expect(allocation.rows.map((row) => row.shipmentId)).toEqual([
      'ship-product-a',
      'ship-product-b',
    ]);
    expect(allocation.rows.map((row) => row.seguroCents)).toEqual([
      4_601,
      2_300,
    ]);
  });

  it('rejects negative seller nets during allocation', () => {
    expect(() =>
      calculateCheckoutAllocation([
        // subtotal 10_000, commission 600, shipping 20_000 -> net = -10_600
        {
          sellerId: 'seller-negative',
          shipmentId: 'ship-neg',
          subtotalCents: 10_000,
          shippingCents: 20_000,
        },
      ]),
    ).toThrow('INVALID_CONNECT_ECONOMICS');
  });

  it('validates reconciliation invariants on a built allocation', () => {
    const allocation = calculateCheckoutAllocation([
      {
        sellerId: 'seller-a',
        shipmentId: 'ship-a',
        subtotalCents: 100_000,
        shippingCents: 20_000,
      },
      {
        sellerId: 'seller-b',
        shipmentId: 'ship-b',
        subtotalCents: 50_000,
        shippingCents: 10_000,
      },
    ]);

    expect(() => assertValidCheckoutAllocation(allocation)).not.toThrow();
  });

  it('fails validation when the buyer total does not reconcile with gross plus seguro', () => {
    const allocation = calculateCheckoutAllocation([
      {
        sellerId: 'seller-a',
        shipmentId: 'ship-a',
        subtotalCents: 100_000,
        shippingCents: 20_000,
      },
    ]);

    const tampered = {
      ...allocation,
      buyerTotalCents: allocation.buyerTotalCents + 1_000,
    };
    expect(() => assertValidCheckoutAllocation(tampered)).toThrow(
      'INVALID_ALLOCATION_RECONCILIATION',
    );
  });

  it('fails validation when a per-row reconciliation is broken', () => {
    const allocation = calculateCheckoutAllocation([
      {
        sellerId: 'seller-a',
        shipmentId: 'ship-a',
        subtotalCents: 100_000,
        shippingCents: 20_000,
      },
    ]);

    const tamperedRow = { ...allocation.rows[0], netCents: 99_999 };
    const tampered = { ...allocation, rows: [tamperedRow] };
    expect(() => assertValidCheckoutAllocation(tampered)).toThrow(
      'INVALID_ALLOCATION_RECONCILIATION',
    );
  });

  it('fails validation when the allocation has no rows', () => {
    expect(() =>
      assertValidCheckoutAllocation({
        rows: [],
        buyerTotalCents: 0,
        totalGrossCents: 0,
        totalCommissionCents: 0,
        totalShippingCents: 0,
        totalSeguroCents: 0,
        totalReleaseCents: 0,
      }),
    ).toThrow('INVALID_ALLOCATION_RECONCILIATION');
  });

  it('preserves each shipment id on its allocation row across multiple sellers', () => {
    const allocation = calculateCheckoutAllocation([
      {
        sellerId: 'seller-a',
        shipmentId: 'ship-a',
        subtotalCents: 100_000,
        shippingCents: 20_000,
      },
      {
        sellerId: 'seller-b',
        shipmentId: 'ship-b',
        subtotalCents: 50_000,
        shippingCents: 10_000,
      },
      {
        sellerId: 'seller-c',
        shipmentId: 'ship-c',
        subtotalCents: 25_000,
        shippingCents: 5_000,
      },
    ]);

    expect(allocation.rows).toHaveLength(3);
    expect(allocation.rows[0].shipmentId).toBe('ship-a');
    expect(allocation.rows[1].shipmentId).toBe('ship-b');
    expect(allocation.rows[2].shipmentId).toBe('ship-c');
    // Seller/shipment stay 1:1 aligned so release can address each shipment.
    expect(
      allocation.rows.map((r) => `${r.sellerId}:${r.shipmentId}`),
    ).toEqual(['seller-a:ship-a', 'seller-b:ship-b', 'seller-c:ship-c']);
  });

  it('rejects an allocation input with a missing or empty shipment id', () => {
    expect(() =>
      calculateCheckoutAllocation([
        {
          sellerId: 'seller-a',
          shipmentId: '',
          subtotalCents: 100_000,
          shippingCents: 20_000,
        },
      ]),
    ).toThrow('INVALID_CHECKOUT_INPUT:missing_shipment_id');

    // Triangulate: absent shipment id (runtime undefined) is also rejected so
    // correlation can never silently fall back to seller id alone.
    expect(() =>
      calculateCheckoutAllocation([
        {
          sellerId: 'seller-a',
          shipmentId: undefined as unknown as string,
          subtotalCents: 100_000,
          shippingCents: 20_000,
        },
      ]),
    ).toThrow('INVALID_CHECKOUT_INPUT:missing_shipment_id');
  });

  it('rejects duplicate shipment ids in the allocation input to prevent ambiguous correlation', () => {
    expect(() =>
      calculateCheckoutAllocation([
        {
          sellerId: 'seller-a',
          shipmentId: 'ship-shared',
          subtotalCents: 100_000,
          shippingCents: 20_000,
        },
        {
          sellerId: 'seller-b',
          shipmentId: 'ship-shared',
          subtotalCents: 50_000,
          shippingCents: 10_000,
        },
      ]),
    ).toThrow('INVALID_CHECKOUT_INPUT:duplicate_shipment_id');
  });

  it('fails reconciliation validation when a row is missing a shipment id', () => {
    const allocation = calculateCheckoutAllocation([
      {
        sellerId: 'seller-a',
        shipmentId: 'ship-a',
        subtotalCents: 100_000,
        shippingCents: 20_000,
      },
    ]);

    const tamperedRow = { ...allocation.rows[0], shipmentId: '' };
    const tampered = { ...allocation, rows: [tamperedRow] };
    expect(() => assertValidCheckoutAllocation(tampered)).toThrow(
      'INVALID_ALLOCATION_RECONCILIATION:missing_shipment_id',
    );
  });

  it('fails reconciliation validation when shipment ids are duplicated across rows', () => {
    const allocation = calculateCheckoutAllocation([
      {
        sellerId: 'seller-a',
        shipmentId: 'ship-a',
        subtotalCents: 100_000,
        shippingCents: 20_000,
      },
      {
        sellerId: 'seller-b',
        shipmentId: 'ship-b',
        subtotalCents: 50_000,
        shippingCents: 10_000,
      },
    ]);

    const tamperedRows = allocation.rows.map((r) =>
      r.sellerId === 'seller-b' ? { ...r, shipmentId: 'ship-a' } : r,
    );
    const tampered = { ...allocation, rows: tamperedRows };
    expect(() => assertValidCheckoutAllocation(tampered)).toThrow(
      'INVALID_ALLOCATION_RECONCILIATION:duplicate_shipment_id',
    );
  });
});
