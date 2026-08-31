import { describe, expect, it } from 'bun:test';

import {
  buildSanitizedEnviaDiagnostics,
  buildSanitizedEnviaResponseMetadata,
  extractEnviaErrorMetadata,
  extractEnviaLabelCostCents,
  sanitizeLabelLogMetadata,
} from './diagnostics';

describe('generate-shipping-label Envia diagnostics', () => {
  it('keeps request diagnostics useful without leaking PII or secrets', () => {
    const diagnostics = buildSanitizedEnviaDiagnostics(
      {
        origin: {
          name: 'Seller Name',
          phone: '5512345678',
          street: 'Secret Street',
          district: 'Private District',
          state: 'CD',
          postalCode: '01000',
          city: 'Ciudad de Mexico',
        },
        destination: {
          name: 'Buyer Name',
          phone: '5598765432',
          street: 'Hidden Avenue',
          district: 'Buyer District',
          state: 'JA',
          postalCode: '44100',
          city: 'Guadalajara',
        },
        packages: [
          {
            type: 'box',
            content: 'Hardware: order123',
            amount: 1,
            declaredValue: 1500,
            lengthUnit: 'CM',
            weightUnit: 'KG',
            weight: 2,
            dimensions: { length: 20, width: 15, height: 10 },
          },
        ],
        shipment: { carrier: 'paquetexpress', service: 'ground', type: 1 },
        settings: {
          currency: 'MXN',
          printFormat: 'PDF',
          printSize: 'STOCK_4X6',
        },
      },
      {
        shipmentId: 'shipment-1',
        endpointBaseUrl: 'https://api-test.envia.com?token=secret',
        mode: 'sandbox',
        itemCount: 1,
        presetKeys: ['gpu'],
      },
    );

    expect(diagnostics).toEqual({
      shipmentId: 'shipment-1',
      endpointBaseUrl: 'https://api-test.envia.com',
      mode: 'sandbox',
      carrier: 'paquetexpress',
      service: 'ground',
      shipmentType: 1,
      printFormat: 'PDF',
      printSize: 'STOCK_4X6',
      currency: 'MXN',
      origin: { state: 'CD', postalCode: '01000', city: 'Ciudad de Mexico' },
      destination: { state: 'JA', postalCode: '44100', city: 'Guadalajara' },
      packageCount: 1,
      packages: [
        {
          type: 'box',
          amount: 1,
          declaredValue: 1500,
          weight: 2,
          dimensions: { length: 20, width: 15, height: 10 },
          lengthUnit: 'CM',
          weightUnit: 'KG',
        },
      ],
      itemCount: 1,
      presetKeys: ['gpu'],
    });

    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain('Seller Name');
    expect(serialized).not.toContain('Buyer Name');
    expect(serialized).not.toContain('5512345678');
    expect(serialized).not.toContain('Secret Street');
    expect(serialized).not.toContain('Private District');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('Hardware: order123');
  });

  it('extracts only Envia error metadata', () => {
    expect(
      extractEnviaErrorMetadata({
        meta: 'error',
        error: {
          code: 1170,
          description: 'Invalid Option',
          message: 'Invalid operation',
        },
        data: [{ label: 'https://example.com/private-label.pdf' }],
      }),
    ).toEqual({
      topLevelKeys: ['data', 'error', 'meta'],
      code: 1170,
    });
  });

  it('extracts Envia label costs from common peso response shapes', () => {
    expect(
      extractEnviaLabelCostCents({
        meta: 'success',
        data: [
          {
            trackingNumber: 'TRACK123',
            label: 'https://example.com/label.pdf',
            totalPrice: 168.75,
          },
        ],
      }),
    ).toEqual({ shippingCostCents: 16_875, sourcePath: '$.totalPrice' });

    expect(
      extractEnviaLabelCostCents({
        data: [{ shipment: { cost: '250.50', currency: 'MXN' } }],
      }),
    ).toEqual({ shippingCostCents: 25_050, sourcePath: '$.shipment.cost' });
  });

  it('exposes integer cents for provider persistence', () => {
    const extraction = extractEnviaLabelCostCents({ data: [{ totalPrice: '168.75' }] });
    expect(extraction?.shippingCostCents).toBe(16_875);
    expect(Number.isInteger(extraction?.shippingCostCents)).toBe(true);
  });

  it('prefers explicit Envia price fields over generic amount fields', () => {
    expect(
      extractEnviaLabelCostCents({
        meta: 'success',
        data: [
          {
            amount: 1,
            totalPrice: 168.75,
          },
        ],
      }),
    ).toEqual({ shippingCostCents: 16_875, sourcePath: '$.totalPrice' });
  });

  it('extracts Envia label costs from explicit cents fields without multiplying twice', () => {
    expect(
      extractEnviaLabelCostCents({
        data: [{ rate: { amount_cents: 12_345 } }],
      }),
    ).toEqual({
      shippingCostCents: 12_345,
      sourcePath: '$.rate.amount_cents',
    });
  });

  it('summarizes Envia response cost metadata without leaking label or tracking values', () => {
    const response = {
      meta: 'success',
      data: [
        {
          trackingNumber: 'TRACK-SECRET',
          label: 'https://example.com/private-label.pdf',
          totalPrice: 180,
        },
      ],
    };
    const extraction = extractEnviaLabelCostCents(response);

    const metadata = buildSanitizedEnviaResponseMetadata(response, extraction);

    expect(metadata).toEqual({
      topLevelKeys: ['data', 'meta'],
      dataItemKeys: ['label', 'totalPrice', 'trackingNumber'],
      amountCandidates: [
        { path: '$.totalPrice', unit: 'pesos', normalizedCents: 18_000 },
        { path: '$.data.0.totalPrice', unit: 'pesos', normalizedCents: 18_000 },
      ],
      selectedCostSourcePath: '$.totalPrice',
      selectedShippingCostCents: 18_000,
    });

    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain('TRACK-SECRET');
    expect(serialized).not.toContain('private-label.pdf');
  });

  it('drops request bodies, provider errors, tokens, and label URLs from label log metadata', () => {
    expect(sanitizeLabelLogMetadata({
      shipmentId: 'shipment-1',
      errorClass: 'provider_rejected',
      body: { originAddress: { street_line1: 'Private street' } },
      stack: 'private provider response',
      authorization: 'Bearer secret',
      labelUrl: 'https://labels.example/private.pdf',
    })).toEqual({
      shipmentId: 'shipment-1',
      errorClass: 'provider_rejected',
    });
  });
});
