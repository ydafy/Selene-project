import { describe, expect, test } from 'bun:test';
import en from '@/shared/i18n/locales/en/orders.json';
import es from '@/shared/i18n/locales/es/orders.json';

import { reviewErrorMessage } from './review-error-message';

// #319: the review toast showed `[<code>] <message>` straight from Postgres.
const t = (key: string) => `t(${key})`;

const postgrestError = (code: string, message: string) =>
  Object.assign(new Error(message), { code, details: null, hint: null });

describe('reviewErrorMessage', () => {
  test('maps a duplicate review (23505) to the already-reviewed message', () => {
    const raw =
      'duplicate key value violates unique constraint "reviews_reviewer_shipment_product_key"';
    const text = reviewErrorMessage(postgrestError('23505', raw), t);

    expect(text).toBe('t(orders:errors.alreadyReviewed)');
    expect(text).not.toContain(raw);
    expect(text).not.toContain('23505');
  });

  test('maps a plain object carrying 23505 the same way', () => {
    expect(reviewErrorMessage({ code: '23505', message: 'dup' }, t)).toBe(
      't(orders:errors.alreadyReviewed)',
    );
  });

  test('maps any other Postgres error to the generic message', () => {
    const raw =
      'new row violates row-level security policy for table "reviews"';
    const text = reviewErrorMessage(postgrestError('42501', raw), t);

    expect(text).toBe('t(common:errors.generic)');
    expect(text).not.toContain(raw);
    expect(text).not.toContain('42501');
  });

  test('maps a non-Error value to the generic message', () => {
    expect(reviewErrorMessage('boom', t)).toBe('t(common:errors.generic)');
    expect(reviewErrorMessage(undefined, t)).toBe('t(common:errors.generic)');
    expect(reviewErrorMessage(null, t)).toBe('t(common:errors.generic)');
  });
});

describe('already-reviewed copy', () => {
  test('exists in English and Spanish', () => {
    expect(en.errors.alreadyReviewed).toBeString();
    expect(es.errors.alreadyReviewed).toBeString();
  });
});
