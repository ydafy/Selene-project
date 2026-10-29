import { describe, expect, it } from 'bun:test';
import {
  getStatusColor,
  isAccountHeld,
  isProductHistory,
} from '../product-status';
import en from '../../i18n/locales/en/profile.json';
import es from '../../i18n/locales/es/profile.json';

// F1 (odd/tasks/auth-hardening.md T8a): a listing hidden by an account suspension keeps its
// prior status in `status_before_account_hold` and comes back when the account is reactivated,
// so it is not history.
describe('listings held by an account suspension', () => {
  it('a HIDDEN listing with a recorded prior status is held, not history', () => {
    const held = { status: 'HIDDEN', status_before_account_hold: 'VERIFIED' };
    expect(isAccountHeld(held)).toBe(true);
    expect(isProductHistory(held.status, held.status_before_account_hold)).toBe(false);
  });

  it('a HIDDEN listing without a prior status stays history', () => {
    const hidden = { status: 'HIDDEN', status_before_account_hold: null };
    expect(isAccountHeld(hidden)).toBe(false);
    expect(isProductHistory(hidden.status, hidden.status_before_account_hold)).toBe(true);
  });

  it('keeps the previous classification for every other status', () => {
    expect(isProductHistory('SOLD')).toBe(true);
    expect(isProductHistory('REJECTED')).toBe(true);
    expect(isProductHistory('HIDDEN')).toBe(true);
    expect(isProductHistory('VERIFIED')).toBe(false);
    expect(isProductHistory(null)).toBe(false);
    expect(isAccountHeld({ status: 'VERIFIED', status_before_account_hold: 'VERIFIED' })).toBe(false);
  });

  it('uses the warning color for a held listing', () => {
    expect(getStatusColor('ACCOUNT_HOLD')).toBe('warning');
  });

  it('has the held label in both languages', () => {
    expect(en.listings.status.ACCOUNT_HOLD).toBe('Paused (account suspended)');
    expect(es.listings.status.ACCOUNT_HOLD).toBe('En pausa (cuenta suspendida)');
  });
});
