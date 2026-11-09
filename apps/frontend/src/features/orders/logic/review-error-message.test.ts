import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    for (const locale of ['en', 'es']) {
      const orders = JSON.parse(
        readFileSync(
          join(
            import.meta.dir,
            '../../../shared/i18n/locales',
            locale,
            'orders.json',
          ),
          'utf8',
        ),
      ) as { errors: Record<string, string> };
      expect(orders.errors.alreadyReviewed).toBeString();
    }
  });
});

describe('ReviewModal error toast guard', () => {
  const modal = readFileSync(
    join(import.meta.dir, '..', 'components', 'review-modal.tsx'),
    'utf8',
  ).replace(/\s+/g, ' ');

  test('shows the mapped message instead of the raw error', () => {
    expect(modal).toContain('text2: reviewErrorMessage(e, t)');
    expect(modal).not.toContain('e.message}');
  });
});
