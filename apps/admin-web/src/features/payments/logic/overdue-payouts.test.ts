import { describe, expect, it } from 'bun:test';

import {
  MAX_HOLD_NOTE_LENGTH,
  canRefundOverduePayout,
  holdNoteErrorMessage,
  holdNoteLength,
  normalizeHoldNote,
  overdueRefundErrorMessage,
  parseHoldNoteResult,
  parseOverdueRefundResult,
} from './overdue-payouts';

describe('hold note rule (same as record-payout-hold-note)', () => {
  it('trims and accepts 1 to 1000 characters', () => {
    expect(MAX_HOLD_NOTE_LENGTH).toBe(1000);
    expect(normalizeHoldNote('  Stripe sigue revisando.  ')).toBe(
      'Stripe sigue revisando.',
    );
    expect(normalizeHoldNote('a')).toBe('a');
    expect(normalizeHoldNote('a'.repeat(1000))).toBe('a'.repeat(1000));
  });

  it('refuses a blank note or one over 1000 characters after trimming', () => {
    expect(normalizeHoldNote('')).toBeNull();
    expect(normalizeHoldNote(' \n\t ')).toBeNull();
    expect(normalizeHoldNote('a'.repeat(1001))).toBeNull();
    expect(normalizeHoldNote(`  ${'a'.repeat(1000)}  `)).toBe('a'.repeat(1000));
  });

  it('counts code points like SQL char_length, so an emoji is one character', () => {
    expect(holdNoteLength('  😀😀 ')).toBe(2);
    expect(normalizeHoldNote('😀'.repeat(1000))).toBe('😀'.repeat(1000));
    expect(normalizeHoldNote('😀'.repeat(1001))).toBeNull();
  });
});

describe('refund offer', () => {
  it('is offered only when Stripe rejected the seller registration', () => {
    expect(canRefundOverduePayout('onboarding_rejected')).toBe(true);
    for (const reason of [
      'onboarding_pending',
      'payouts_disabled',
      'account_not_actionable',
      'rejected',
      null,
    ])
      expect(canRefundOverduePayout(reason)).toBe(false);
  });
});

describe('response parsing', () => {
  const note = {
    id: '9c000000-0000-4000-8000-000000000001',
    shipment_id: '7b310000-0000-4000-8000-000000000011',
    note: 'Stripe sigue revisando la cuenta.',
    noted_at: '2026-11-14T05:27:34.123456+00:00',
    noted_by: '00000000-0000-4000-8000-000000000001',
  };

  it('reads the stored hold note', () => {
    expect(parseHoldNoteResult(note)).toEqual({
      id: note.id,
      shipmentId: note.shipment_id,
      note: note.note,
      notedAt: note.noted_at,
      notedBy: note.noted_by,
    });
  });

  it('fails on a malformed hold note response', () => {
    for (const broken of [
      null,
      {},
      { ...note, note: '' },
      { ...note, noted_at: 'yesterday' },
      { ...note, noted_by: 7 },
    ])
      expect(() => parseHoldNoteResult(broken)).toThrow();
  });

  const refund = {
    status: 'refunded',
    shipment_id: note.shipment_id,
    refund_id: 're_3Q',
    amount_cents: 10600,
  };

  it('reads a refunded and a pending refund', () => {
    expect(parseOverdueRefundResult(refund)).toEqual({
      status: 'refunded',
      shipmentId: refund.shipment_id,
      refundId: 're_3Q',
      amountCents: 10600,
    });
    expect(
      parseOverdueRefundResult({ ...refund, status: 'pending' }).status,
    ).toBe('pending');
  });

  it('fails on a malformed refund response, never showing a wrong amount', () => {
    for (const broken of [
      null,
      { ...refund, status: 'failed' },
      { ...refund, amount_cents: 106.5 },
      { ...refund, amount_cents: 0 },
      { ...refund, amount_cents: '10600' },
      { ...refund, refund_id: '' },
    ])
      expect(() => parseOverdueRefundResult(broken)).toThrow();
  });
});

describe('error messages', () => {
  it('maps every hold note code and falls back for server errors', () => {
    const messages = [
      'PAYOUT_NOT_OVERDUE',
      'INVALID_HOLD_NOTE',
      'INVALID_SHIPMENT_ID',
      'SHIPMENT_NOT_FOUND',
      'ADMIN_ONLY',
      'AUTH_REQUIRED',
    ].map(holdNoteErrorMessage);
    expect(new Set(messages).size).toBe(messages.length);
    expect(holdNoteErrorMessage('PAYOUT_NOT_OVERDUE')).toContain(
      'ya no está vencido',
    );
    expect(holdNoteErrorMessage('INVALID_HOLD_NOTE')).toContain('1000');
    expect(holdNoteErrorMessage('ADMIN_ONLY')).toContain('administrador');
    const generic = holdNoteErrorMessage(null);
    expect(holdNoteErrorMessage('INTERNAL_ERROR')).toBe(generic);
    expect(generic).toContain('No se guardó la nota');
  });

  it('maps every refund refusal to a specific message', () => {
    const codes = [
      'REFUND_FAILED',
      'REFUND_IN_PROGRESS',
      'SELLER_ACCOUNT_NOT_REJECTED',
      'PAYMENT_METHOD_NOT_REFUNDABLE',
      'PAYOUT_NOT_OVERDUE',
      'SHIPMENT_NOT_COMPLETED',
      'SHIPMENT_ALREADY_REFUNDED',
      'SHIPMENT_FUNDS_ALREADY_RELEASED',
      'SHIPMENT_TRANSFER_OPERATION_ACTIVE',
      'PAYOUT_RUN_NOT_PARKED',
      'SHIPMENT_CANCELLATION_OPERATION_ACTIVE',
      'REFUND_AMOUNT_EXCEEDS_CAP',
      'REFUND_RECOVERY_REQUIRED',
      'REFUND_UNCONFIRMED',
      'STRIPE_REQUEST_FAILED',
      'REFUND_COMPLETION_FAILED',
      'SHIPMENT_NOT_FOUND',
      'ADMIN_ONLY',
    ];
    const messages = codes.map(overdueRefundErrorMessage);
    expect(new Set(messages).size).toBe(codes.length);
    expect(messages).not.toContain(overdueRefundErrorMessage(null));
    expect(overdueRefundErrorMessage('REFUND_FAILED')).toContain(
      'Reembolsos con problemas',
    );
    expect(overdueRefundErrorMessage('REFUND_IN_PROGRESS')).toContain(
      'Intenta de nuevo en unos minutos',
    );
    expect(overdueRefundErrorMessage('SELLER_ACCOUNT_NOT_REJECTED')).toContain(
      'no rechazó',
    );
    expect(
      overdueRefundErrorMessage('PAYMENT_METHOD_NOT_REFUNDABLE'),
    ).toContain('tarjeta');
  });

  it('never claims a refund happened when the server failed', () => {
    const generic = overdueRefundErrorMessage(null);
    expect(overdueRefundErrorMessage('INTERNAL_ERROR')).toBe(generic);
    expect(generic).toContain('No sabemos si');
  });
});
