import { describe, expect, it } from 'bun:test';
import { resolvePaymentSetupNeed } from './payment-setup-need';

// odd/tasks/first-listing-payment-setup.md
const known = { isLoading: false, isError: false };

describe('resolvePaymentSetupNeed', () => {
  it('needs setup for a pending or missing status and review for a rejected one', () => {
    expect(resolvePaymentSetupNeed({ ...known, status: 'pending' })).toBe(
      'setup',
    );
    expect(resolvePaymentSetupNeed({ ...known, status: null })).toBe('setup');
    expect(resolvePaymentSetupNeed({ ...known, status: 'rejected' })).toBe(
      'rejected',
    );
  });

  it('needs nothing once payments are complete', () => {
    expect(resolvePaymentSetupNeed({ ...known, status: 'complete' })).toBe(
      null,
    );
  });

  // S1-S4: an unknown status behaves as today and never blocks the seller (S5).
  it('needs nothing while the status is loading or failed', () => {
    expect(
      resolvePaymentSetupNeed({
        status: null,
        isLoading: true,
        isError: false,
      }),
    ).toBe(null);
    expect(
      resolvePaymentSetupNeed({
        status: null,
        isLoading: false,
        isError: true,
      }),
    ).toBe(null);
  });
});
