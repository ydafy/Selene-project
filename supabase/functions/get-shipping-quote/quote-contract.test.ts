import { describe, expect, it } from 'bun:test';

import { selectPaquetexpressGroundRate } from './quote-contract.ts';

const validRate = {
  carrier: 'Paquetexpress',
  service: 'ground',
  currency: 'MXN',
  totalPrice: '168.75',
};

describe('selectPaquetexpressGroundRate', () => {
  it('returns the sole Paquetexpress Ground MXN quote for a real seller origin', () => {
    expect(selectPaquetexpressGroundRate([validRate], '64000')).toEqual({
      carrier: 'Paquetexpress',
      service: 'ground',
      price: 168.75,
      estimated_days: 3,
    });
  });

  it('rejects any non-Paquetexpress, non-Ground, non-MXN, or branch-only rate', () => {
    for (const invalidRate of [
      { ...validRate, carrier: 'Estafeta' },
      { ...validRate, service: 'express' },
      { ...validRate, currency: 'USD' },
      { ...validRate, service: 'ground_do' },
      { ...validRate, service: 'ground_od' },
    ]) {
      expect(() => selectPaquetexpressGroundRate([invalidRate], '64000')).toThrow(
        'UNSUPPORTED_SHIPPING_RATE',
      );
    }
  });

  it('rejects ambiguous provider responses', () => {
    expect(() =>
      selectPaquetexpressGroundRate([validRate, validRate], '64000'),
    ).toThrow('UNSUPPORTED_SHIPPING_RATE');
  });
});
