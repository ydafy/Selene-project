import { describe, expect, test } from 'bun:test';

import en from '../i18n/locales/en/product.json';
import es from '../i18n/locales/es/product.json';

import {
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASONS,
  buildReportInsert,
  reportCopy,
  reportOutcome,
} from './use-moderation.logic';

describe('buildReportInsert', () => {
  test('a listing report sets only target_product_id', () => {
    expect(
      buildReportInsert({
        reporterId: 'me',
        target: { context: 'product', id: 'p1' },
        reason: 'counterfeit_or_misdescribed',
        details: 'Not the GPU in the photos',
      }),
    ).toEqual({
      reporter_id: 'me',
      target_product_id: 'p1',
      reason: 'counterfeit_or_misdescribed',
      details: 'Not the GPU in the photos',
    });
  });

  test('a user report sets only target_user_id', () => {
    expect(
      buildReportInsert({
        reporterId: 'me',
        target: { context: 'user', id: 'u1' },
        reason: 'harassment',
      }),
    ).toEqual({
      reporter_id: 'me',
      target_user_id: 'u1',
      reason: 'harassment',
      details: null,
    });
  });

  test('details are trimmed and blank details are stored as null', () => {
    const build = (details: string) =>
      buildReportInsert({
        reporterId: 'me',
        target: { context: 'user', id: 'u1' },
        reason: 'other',
        details,
      }).details;
    expect(build('  rude messages  ')).toBe('rude messages');
    expect(build('   ')).toBeNull();
  });
});

describe('reportOutcome', () => {
  test('no error is a success', () => {
    expect(reportOutcome(null)).toBe('success');
    expect(reportOutcome(undefined)).toBe('success');
  });

  test('a unique violation means the target is already reported', () => {
    expect(reportOutcome({ code: '23505', message: 'duplicate key' })).toBe(
      'already_reported',
    );
  });

  test('any other failure is a generic error', () => {
    expect(reportOutcome({ code: '42501', message: 'denied' })).toBe('error');
    expect(reportOutcome(new Error('network'))).toBe('error');
    expect(reportOutcome('not_logged_in')).toBe('error');
  });
});

describe('reportCopy', () => {
  test('each outcome has distinct copy', () => {
    for (const context of ['product', 'user'] as const) {
      const copies = (['success', 'already_reported', 'error'] as const).map(
        (outcome) => reportCopy(context, outcome),
      );
      expect(new Set(copies.map((c) => c.text1Key)).size).toBe(3);
      expect(new Set(copies.map((c) => c.text2Key)).size).toBe(3);
      expect(copies.map((c) => c.type)).toEqual(['success', 'info', 'error']);
    }
  });

  test('a user report never uses listing copy', () => {
    for (const outcome of ['success', 'already_reported'] as const) {
      const copy = reportCopy('user', outcome);
      expect(copy.text1Key).toStartWith('product:report.user.');
      expect(copy.text2Key).toStartWith('product:report.user.');
      expect(reportCopy('product', outcome).text2Key).toStartWith(
        'product:report.product.',
      );
    }
  });
});

test('the picker offers the seven database reasons in order', () => {
  expect(REPORT_REASONS).toEqual([
    'fraud',
    'counterfeit_or_misdescribed',
    'prohibited_item',
    'offensive_content',
    'harassment',
    'spam',
    'other',
  ]);
  expect(REPORT_DETAILS_MAX_LENGTH).toBe(1000);
});

test('every report string exists in English and Spanish', () => {
  const keys = [
    ...REPORT_REASONS.map((reason) => `product:report.reasons.${reason}`),
    ...(['product', 'user'] as const).flatMap((context) => [
      `product:report.${context}.action`,
      `product:report.${context}.title`,
      ...(['success', 'already_reported', 'error'] as const).flatMap(
        (outcome) => {
          const copy = reportCopy(context, outcome);
          return [copy.text1Key, copy.text2Key];
        },
      ),
    ]),
    'product:report.reasonLabel',
    'product:report.detailsLabel',
    'product:report.detailsPlaceholder',
    'product:report.submit',
  ];
  const lookup = (locale: unknown, key: string) =>
    key
      .replace('product:', '')
      .split('.')
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        locale,
      );
  for (const key of keys) {
    expect(typeof lookup(en, key), key).toBe('string');
    expect(typeof lookup(es, key), key).toBe('string');
  }
});
