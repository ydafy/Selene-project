import { describe, expect, it } from 'bun:test';

import {
  buyerDestinationSnapshotSchema,
  buildBuyerDestinationFromStoredSnapshot,
  buildEnviaShipmentConfiguration,
  classifyEnviaGenerateOutcome,
  listingReferenceDestinationSchema,
  normalizeEnviaStateCode,
  redactEnviaDiagnostics,
  resolveEnviaRuntimeConfiguration,
  selectPaquetexpressGroundRate,
  toMxnCents,
} from '../envia-shipping.ts';

const validDestination = {
  name: 'María López',
  phone: '5512345678',
  street: 'Avenida Reforma',
  number: '100',
  district: 'Juárez',
  city: 'Ciudad de México',
  state: 'CMX',
  country: 'MX',
  postalCode: '06600',
};

describe('Envia destination schemas', () => {
  it('rejects incomplete provider-required listing references and invalid state codes', () => {
    expect(listingReferenceDestinationSchema.safeParse({ ...validDestination, phone: undefined }).success).toBe(false);
    expect(listingReferenceDestinationSchema.safeParse({ ...validDestination, state: 'MX' }).success).toBe(false);
  });

  it('accepts a complete listing reference and rejects the same invalid state for buyer snapshots', () => {
    expect(listingReferenceDestinationSchema.safeParse(validDestination).success).toBe(true);
    expect(buyerDestinationSnapshotSchema.safeParse({ ...validDestination, state: 'MX' }).success).toBe(false);
  });

  it('normalizes allowed state codes and preserves the two-letter Nuevo León code', () => {
    expect(normalizeEnviaStateCode(' nL ')).toBe('NL');
    expect(buyerDestinationSnapshotSchema.safeParse({ ...validDestination, state: ' slp ' }).data?.state).toBe('SLP');
    expect(normalizeEnviaStateCode('NLE')).toBeNull();
  });

  it('projects only stored buyer fields and omits a missing house number', () => {
    const { number: _number, ...destinationWithoutNumber } = validDestination;
    expect(buildBuyerDestinationFromStoredSnapshot({
      full_name: 'María López', phone: '5512345678', street_line1: 'Avenida Reforma',
      district: 'Juárez', city: 'Ciudad de México', state: 'CMX', country: 'MX', zip_code: '06600',
    })).toEqual({ ...destinationWithoutNumber, state: 'CMX' });
    expect(buildBuyerDestinationFromStoredSnapshot({ ...validDestination, full_name: undefined })).toBeNull();
  });
});

describe('Envia runtime configuration', () => {
  it('requires an explicit supported mode with its selected key and HTTPS URL', () => {
    expect(resolveEnviaRuntimeConfiguration({ ENVIA_MODE: undefined })).toBeNull();
    expect(resolveEnviaRuntimeConfiguration({ ENVIA_MODE: 'sandbox', ENVIA_API_KEY_SANDBOX: 'key', ENVIA_API_URL_SANDBOX: 'http://envia.example' })).toBeNull();
  });

  it('accepts the selected HTTPS configuration and test-only localhost seam', () => {
    expect(resolveEnviaRuntimeConfiguration({ ENVIA_MODE: 'production', ENVIA_API_KEY_PROD: 'key', ENVIA_API_URL_PROD: 'https://api.envia.com' })).toEqual({ mode: 'production', apiKey: 'key', apiUrl: 'https://api.envia.com/' });
    expect(resolveEnviaRuntimeConfiguration({ ENVIA_MODE: 'sandbox', ENVIA_API_KEY_SANDBOX: 'key', ENVIA_API_URL_SANDBOX: 'http://localhost:8787' }, { allowInsecureLocalhost: true })?.apiUrl).toBe('http://localhost:8787/');
  });
});

describe('Envia generation outcome classification', () => {
  it('releases only proven provider rejections', () => {
    expect(classifyEnviaGenerateOutcome({ status: 422, body: { error: 'invalid destination' } })).toBe('retryable_rejected');
    expect(classifyEnviaGenerateOutcome({ status: 400, body: { code: 'VALIDATION_ERROR' } })).toBe('retryable_rejected');
  });

  it('fails closed for timeouts, connection loss, and malformed or contradictory responses', () => {
    expect(classifyEnviaGenerateOutcome({ kind: 'timeout' })).toBe('orphan_pending');
    expect(classifyEnviaGenerateOutcome({ kind: 'connection_lost' })).toBe('orphan_pending');
    expect(classifyEnviaGenerateOutcome({ status: 201, body: { trackingNumber: 'TRACK-1' } })).toBe('orphan_pending');
    expect(classifyEnviaGenerateOutcome({ status: 422, body: { trackingNumber: 'TRACK-1', error: 'invalid destination' } })).toBe('orphan_pending');
  });
});

describe('Envia MXN values and diagnostics', () => {
  it('converts finite non-negative MXN provider totals to integer cents', () => {
    expect(toMxnCents('123.45')).toBe(12_345);
    expect(toMxnCents(0.1 + 0.2)).toBe(30);
  });

  it('fails safely for invalid provider totals', () => {
    expect(toMxnCents('-1')).toBeNull();
    expect(toMxnCents('not-a-price')).toBeNull();
    expect(toMxnCents(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('redacts PII, labels, raw responses, and secrets while retaining safe diagnostics', () => {
    expect(redactEnviaDiagnostics({
      estimatePolicy: 'listing_reference_destination',
      city: 'Ciudad de México',
      state: 'Ciudad de México',
      name: 'María López',
      street: 'Avenida Reforma 100',
      phone: '5512345678',
      labelUrl: 'https://labels.example/private.pdf',
      rawProviderResponse: { token: 'provider-secret' },
      authorization: 'Bearer provider-secret',
      responseKeys: ['meta', 'data'],
    })).toEqual({
      estimatePolicy: 'listing_reference_destination',
      city: 'Ciudad de México',
      state: 'Ciudad de México',
      responseKeys: ['meta', 'data'],
    });
  });
});

describe('Envia shipment configuration', () => {
  it('builds the outbound Paquetexpress ground and print payload from the configured tuple', () => {
    expect(buildEnviaShipmentConfiguration({
      envia_carrier: 'paquetexpress',
      envia_service: 'ground',
      envia_print_format: 'ZPL',
      envia_print_size: 'STOCK_4X6',
    })).toEqual({
      shipment: { carrier: 'paquetexpress', service: 'ground', type: 1 },
      settings: { currency: 'MXN', printFormat: 'ZPL', printSize: 'STOCK_4X6' },
    });
  });

  it('fails closed for any configured carrier or service outside the sole label policy', () => {
    const base = {
      envia_carrier: 'paquetexpress',
      envia_service: 'ground',
      envia_print_format: 'PDF',
      envia_print_size: 'STOCK_4X6',
    };

    expect(buildEnviaShipmentConfiguration({ ...base, envia_carrier: 'Estafeta' })).toBeNull();
    expect(buildEnviaShipmentConfiguration({ ...base, envia_service: 'Express' })).toBeNull();
  });

  it('fails closed when any configured carrier, service, or print value is missing', () => {
    expect(buildEnviaShipmentConfiguration({
      envia_carrier: 'paquetexpress',
      envia_service: '',
      envia_print_format: 'PDF',
      envia_print_size: 'STOCK_4X6',
    })).toBeNull();
  });
});

describe('Paquetexpress ground rate policy', () => {
  const exactRate = {
    carrier: 'Paquetexpress',
    service: 'ground',
    totalPrice: '168.75',
    currency: 'MXN',
    quoteId: 'quote-1',
  };

  it('accepts exactly one Paquetexpress ground MXN rate and preserves its evidence', () => {
    expect(selectPaquetexpressGroundRate([exactRate])).toEqual({
      carrier: 'Paquetexpress',
      service: 'ground',
      quoteReference: 'quote-1',
      quotedCostCents: 16_875,
    });
  });

  it('fails closed for alternate carriers, services, duplicate matches, and invalid currency', () => {
    expect(selectPaquetexpressGroundRate([{ ...exactRate, carrier: 'Estafeta' }])).toBeNull();
    expect(selectPaquetexpressGroundRate([{ ...exactRate, service: 'Express' }])).toBeNull();
    expect(selectPaquetexpressGroundRate([exactRate, { ...exactRate, quoteId: 'quote-2' }])).toBeNull();
    expect(selectPaquetexpressGroundRate([{ ...exactRate, currency: 'USD' }])).toBeNull();
  });
});
