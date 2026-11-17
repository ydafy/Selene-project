import { describe, expect, it } from 'bun:test';
import { getStatusColor, resolveListingStatusKey } from './product-status';
import en from '@/shared/i18n/locales/en/profile.json';
import es from '@/shared/i18n/locales/es/profile.json';

// S4 (odd/tasks/first-listing-payment-setup.md): a verified listing nobody can buy
// must not say "Activo".
const verified = { status: 'verified', status_before_account_hold: null };

describe('listing chip when payments are not set up', () => {
  it('replaces "Activo" on a verified listing', () => {
    expect(resolveListingStatusKey(verified, 'setup')).toBe('PAYMENTS_SETUP');
    expect(resolveListingStatusKey(verified, 'rejected')).toBe(
      'PAYMENTS_REJECTED',
    );
  });

  it('keeps the database status when payments are set up or unknown', () => {
    expect(resolveListingStatusKey(verified, null)).toBe('verified');
  });

  it('keeps every other status as it is', () => {
    for (const status of [
      'pending_verification',
      'in_review',
      'sold',
      'rejected',
      'hidden',
      'in_dispute',
    ]) {
      expect(
        resolveListingStatusKey(
          { status, status_before_account_hold: null },
          'setup',
        ),
      ).toBe(status);
    }
  });

  it('uses warning for missing payments and error for rejected ones', () => {
    expect(getStatusColor('PAYMENTS_SETUP')).toBe('warning');
    expect(getStatusColor('PAYMENTS_REJECTED')).toBe('error');
  });

  it('has the labels in both languages', () => {
    expect(es.listings.status.PAYMENTS_SETUP).toBe('Falta activar cobros');
    expect(es.listings.status.PAYMENTS_REJECTED).toBe('Revisa tus cobros');
    expect(en.listings.status.PAYMENTS_SETUP).toBe('Payments not set up');
    expect(en.listings.status.PAYMENTS_REJECTED).toBe('Check your payments');
  });
});
