import { describe, expect, it } from 'bun:test';
import {
  MAX_RESOLUTION_NOTE_LENGTH,
  parseLabelReconciliations,
  parseResolveResult,
  pesosToCents,
  resolveLabelReconciliationErrorMessage,
  validateLabelFoundForm,
} from './labelReconciliations';

const row = {
  shipment_id: '11111111-aaaa-bbbb-cccc-000000000001',
  order_id: '22222222-aaaa-bbbb-cccc-000000000001',
  seller_id: '33333333-aaaa-bbbb-cccc-000000000001',
  seller_name: 'vendedor_uno',
  buyer_id: '44444444-aaaa-bbbb-cccc-000000000001',
  buyer_name: 'comprador_uno',
  shipment_created_at: '2026-10-20T10:00:00.000Z',
  label_generation_state: 'orphan_pending',
  stuck_at: '2026-10-21T10:00:00.000Z',
  claim_expires_at: null,
  last_label_event_at: '2026-10-21T10:00:00.000Z',
  quote_carrier: 'paquetexpress',
  quote_service: 'ground',
  quote_cost_cents: 15000,
  quote_rated_at: '2026-10-20T10:00:00.000Z',
  origin_postal_code: '64000',
  origin_city: 'Monterrey',
  destination_postal_code: '06600',
  destination_city: 'Ciudad de México',
};
const mapped = {
  shipmentId: row.shipment_id,
  orderId: row.order_id,
  sellerId: row.seller_id,
  sellerName: 'vendedor_uno',
  buyerId: row.buyer_id,
  buyerName: 'comprador_uno',
  createdAt: '2026-10-20T10:00:00.000Z',
  state: 'orphan_pending',
  stuckAt: '2026-10-21T10:00:00.000Z',
  claimExpiresAt: null,
  lastLabelEventAt: '2026-10-21T10:00:00.000Z',
  quoteCarrier: 'paquetexpress',
  quoteService: 'ground',
  quoteCostCents: 15000,
  quoteRatedAt: '2026-10-20T10:00:00.000Z',
  originPostalCode: '64000',
  originCity: 'Monterrey',
  destinationPostalCode: '06600',
  destinationCity: 'Ciudad de México',
};

describe('parseLabelReconciliations', () => {
  it('maps the server contract, including null optional fields', () => {
    const sparse = {
      ...row,
      seller_name: null,
      buyer_name: null,
      label_generation_state: 'claimed',
      claim_expires_at: '2026-10-21T09:00:00.000Z',
      last_label_event_at: null,
      quote_carrier: null,
      quote_service: null,
      quote_cost_cents: null,
      quote_rated_at: null,
      origin_postal_code: null,
      origin_city: null,
      destination_postal_code: null,
      destination_city: null,
    };
    expect(parseLabelReconciliations({ label_reconciliations: [row, sparse] })).toEqual([
      mapped,
      {
        ...mapped,
        sellerName: null,
        buyerName: null,
        state: 'claimed',
        claimExpiresAt: '2026-10-21T09:00:00.000Z',
        lastLabelEventAt: null,
        quoteCarrier: null,
        quoteService: null,
        quoteCostCents: null,
        quoteRatedAt: null,
        originPostalCode: null,
        originCity: null,
        destinationPostalCode: null,
        destinationCity: null,
      },
    ]);
    expect(parseLabelReconciliations({ label_reconciliations: [] })).toEqual([]);
  });

  const malformed: Array<[string, unknown]> = [
    ['null payload', null],
    ['missing key', {}],
    ['not an array', { label_reconciliations: 'x' }],
    ['a non-object row', { label_reconciliations: [row, 'x'] }],
    ['empty shipment id', { label_reconciliations: [{ ...row, shipment_id: '' }] }],
    ['missing order id', { label_reconciliations: [{ ...row, order_id: undefined }] }],
    ['unknown state', { label_reconciliations: [{ ...row, label_generation_state: 'generated' }] }],
    ['invalid stuck date', { label_reconciliations: [{ ...row, stuck_at: 'not a date' }] }],
    ['null stuck date', { label_reconciliations: [{ ...row, stuck_at: null }] }],
    ['invalid created date', { label_reconciliations: [{ ...row, shipment_created_at: 'x' }] }],
    ['invalid claim date', { label_reconciliations: [{ ...row, claim_expires_at: 'x' }] }],
    ['undefined seller name', { label_reconciliations: [{ ...row, seller_name: undefined }] }],
    ['fractional cost', { label_reconciliations: [{ ...row, quote_cost_cents: 150.5 }] }],
    ['negative cost', { label_reconciliations: [{ ...row, quote_cost_cents: -1 }] }],
    ['string cost', { label_reconciliations: [{ ...row, quote_cost_cents: '15000' }] }],
    ['numeric postal code', { label_reconciliations: [{ ...row, origin_postal_code: 64000 }] }],
    ['one bad row among good ones', { label_reconciliations: [row, { ...row, buyer_id: null }] }],
  ];
  for (const [name, payload] of malformed) {
    it(`fails closed on ${name}`, () => {
      expect(() => parseLabelReconciliations(payload)).toThrow();
    });
  }
});

describe('parseResolveResult', () => {
  it('maps a resolved shipment', () => {
    expect(
      parseResolveResult({
        result: 'resolved',
        resolution: 'no_label',
        shipment_id: row.shipment_id,
        status: 'paid',
        label_generation_state: 'unclaimed',
      }),
    ).toEqual({ resolution: 'no_label', status: 'paid', labelGenerationState: 'unclaimed' });
  });

  it('fails closed on anything else', () => {
    const ok = { result: 'resolved', resolution: 'label_found', shipment_id: 'x', status: 'preparing', label_generation_state: 'generated' };
    for (const payload of [
      null,
      'x',
      {},
      { ...ok, result: 'already_resolved' },
      { ...ok, resolution: 'maybe' },
      { ...ok, status: 5 },
      { ...ok, label_generation_state: null },
    ]) {
      expect(() => parseResolveResult(payload)).toThrow();
    }
  });
});

describe('pesosToCents', () => {
  it('converts whole and decimal pesos to integer cents without float drift', () => {
    expect(pesosToCents('150')).toBe(15000);
    expect(pesosToCents('150.5')).toBe(15050);
    expect(pesosToCents('150.50')).toBe(15050);
    expect(pesosToCents(' 93.00 ')).toBe(9300);
    expect(pesosToCents('0')).toBe(0);
    expect(pesosToCents('0.07')).toBe(7);
    expect(pesosToCents('1.15')).toBe(115);
    expect(pesosToCents('19.99')).toBe(1999);
  });

  it('rejects non-numeric, negative, extra-decimal and empty input', () => {
    for (const input of ['', '  ', 'abc', '12abc', '-5', '-0.50', '1.234', '1,50', '1e3', '.5', '5.', '$150', '1 50', '99999999']) {
      expect(pesosToCents(input)).toBeNull();
    }
  });
});

describe('validateLabelFoundForm', () => {
  const valid = {
    trackingNumber: ' PX123 ',
    labelUrl: ' https://labels.example/px123.pdf ',
    enviaShipmentId: ' 98765 ',
    costPesos: '93.50',
    note: '  Está en el panel de Envía  ',
  };

  it('returns the trimmed values with the cost in integer cents', () => {
    expect(validateLabelFoundForm(valid)).toEqual({
      ok: true,
      value: {
        trackingNumber: 'PX123',
        labelUrl: 'https://labels.example/px123.pdf',
        enviaShipmentId: '98765',
        providerCostCents: 9350,
        note: 'Está en el panel de Envía',
      },
    });
  });

  it('names the first field that is wrong', () => {
    const cases: Array<[Partial<typeof valid>, string]> = [
      [{ trackingNumber: '  ' }, 'trackingNumber'],
      [{ labelUrl: '' }, 'labelUrl'],
      [{ labelUrl: 'no es una url' }, 'labelUrl'],
      [{ labelUrl: 'javascript:alert(1)' }, 'labelUrl'],
      [{ enviaShipmentId: '' }, 'enviaShipmentId'],
      [{ costPesos: '' }, 'costPesos'],
      [{ costPesos: '-3' }, 'costPesos'],
      [{ costPesos: 'abc' }, 'costPesos'],
      [{ note: '   ' }, 'note'],
      [{ note: 'x'.repeat(MAX_RESOLUTION_NOTE_LENGTH + 1) }, 'note'],
    ];
    for (const [override, field] of cases) {
      const result = validateLabelFoundForm({ ...valid, ...override });
      expect(result).toMatchObject({ ok: false, field });
    }
  });
});

describe('resolveLabelReconciliationErrorMessage', () => {
  it('maps every stable server code to plain Spanish', () => {
    for (const code of [
      'AUTH_REQUIRED',
      'ADMIN_ONLY',
      'SHIPMENT_NOT_FOUND',
      'ALREADY_RESOLVED',
      'INVALID_RESOLUTION_NOTE',
      'INVALID_PROVIDER_RESULT',
      'LABEL_SETTINGS_MISSING',
      'INVALID_SHIPMENT_ID',
    ]) {
      const message = resolveLabelReconciliationErrorMessage(code);
      expect(message).not.toBe(resolveLabelReconciliationErrorMessage(null));
      expect(message).not.toBe(resolveLabelReconciliationErrorMessage('SOMETHING_ELSE'));
    }
  });

  it('says in friendly words that the shipment was already resolved', () => {
    expect(resolveLabelReconciliationErrorMessage('ALREADY_RESOLVED')).toContain('ya no está pendiente');
  });

  it('falls back to a generic message', () => {
    expect(resolveLabelReconciliationErrorMessage(null)).toContain('Intenta de nuevo');
    expect(resolveLabelReconciliationErrorMessage('UNKNOWN')).toContain('Intenta de nuevo');
  });
});
