import { describe, expect, it } from 'bun:test';
import {
  getStatusColor,
  isAccountHeld,
  isProductHistory,
} from './product-status';
import en from '@/shared/i18n/locales/en/profile.json';
import es from '@/shared/i18n/locales/es/profile.json';

// F1 (odd/tasks/auth-hardening.md T8a): a listing hidden by an account suspension keeps its
// prior status in `status_before_account_hold` and comes back when the account is reactivated,
// so it is not history.
describe('listings held by an account suspension', () => {
  it('a hidden listing with a recorded prior status is held, not history', () => {
    const held = { status: 'hidden', status_before_account_hold: 'verified' };
    expect(isAccountHeld(held)).toBe(true);
    expect(isProductHistory(held.status, held.status_before_account_hold)).toBe(
      false,
    );
  });

  it('a hidden listing without a prior status stays history', () => {
    const hidden = { status: 'hidden', status_before_account_hold: null };
    expect(isAccountHeld(hidden)).toBe(false);
    expect(
      isProductHistory(hidden.status, hidden.status_before_account_hold),
    ).toBe(true);
  });

  it('keeps the previous classification for every other status', () => {
    expect(isProductHistory('sold')).toBe(true);
    expect(isProductHistory('rejected')).toBe(true);
    expect(isProductHistory('hidden')).toBe(true);
    expect(isProductHistory('verified')).toBe(false);
    expect(isProductHistory(null)).toBe(false);
    expect(
      isAccountHeld({
        status: 'verified',
        status_before_account_hold: 'verified',
      }),
    ).toBe(false);
  });

  it('uses the warning color for a held listing', () => {
    expect(getStatusColor('ACCOUNT_HOLD')).toBe('warning');
  });

  it('labels every listing status by its lowercase database value in both languages', () => {
    for (const status of [
      'verified',
      'in_review',
      'pending_verification',
      'sold',
      'rejected',
      'hidden',
      'in_dispute',
    ]) {
      expect(en.listings.status).toHaveProperty(status);
      expect(es.listings.status).toHaveProperty(status);
    }
  });

  it('has the held label in both languages', () => {
    expect(en.listings.status.ACCOUNT_HOLD).toBe('Paused (account suspended)');
    expect(es.listings.status.ACCOUNT_HOLD).toBe(
      'En pausa (cuenta suspendida)',
    );
  });
});
