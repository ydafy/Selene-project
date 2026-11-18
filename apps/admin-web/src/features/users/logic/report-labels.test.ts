import { expect, it } from 'bun:test';
import {
  REPORT_REASON_LABELS,
  reportReasonLabel,
  reportStatusLabel,
} from './report-labels';

it('labels every report reason in Spanish, like the app report dialog', () => {
  expect(REPORT_REASON_LABELS).toEqual({
    fraud: 'Fraude o estafa',
    counterfeit_or_misdescribed: 'Falsificado o no coincide con la descripción',
    prohibited_item: 'Artículo prohibido',
    offensive_content: 'Contenido ofensivo',
    harassment: 'Acoso',
    spam: 'Spam',
    other: 'Otro',
  });
  expect(reportReasonLabel('harassment')).toBe('Acoso');
});

it('says an open report is open and has no outcome yet', () => {
  expect(reportStatusLabel({ status: 'open', outcome: null })).toBe('Abierta');
});

it('names the outcome of a resolved report', () => {
  expect(reportStatusLabel({ status: 'resolved', outcome: 'dismissed' })).toBe(
    'Resuelta: descartada',
  );
  expect(reportStatusLabel({ status: 'resolved', outcome: 'warned' })).toBe(
    'Resuelta: usuario advertido',
  );
  expect(
    reportStatusLabel({ status: 'resolved', outcome: 'listing_removed' }),
  ).toBe('Resuelta: publicación retirada');
  expect(
    reportStatusLabel({ status: 'resolved', outcome: 'account_suspended' }),
  ).toBe('Resuelta: cuenta suspendida');
});
