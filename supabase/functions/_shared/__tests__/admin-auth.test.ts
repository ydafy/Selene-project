import { describe, expect, it } from 'bun:test';

import { isActiveAdmin } from '../admin-auth.ts';
import { isActiveAdmin as reExported } from '../../resolve-shipment-refund/handler.ts';

describe('isActiveAdmin', () => {
  it('accepts an admin with an active or NULL status', () => {
    expect(isActiveAdmin({ role: 'admin', status: 'active' })).toBe(true);
    expect(isActiveAdmin({ role: 'admin', status: null })).toBe(true);
    expect(isActiveAdmin({ role: 'admin' })).toBe(true);
  });

  it('refuses missing rows, other roles and non-active admins', () => {
    expect(isActiveAdmin(null)).toBe(false);
    expect(isActiveAdmin({ role: 'buyer', status: 'active' })).toBe(false);
    expect(isActiveAdmin({ role: 'admin', status: 'suspended' })).toBe(false);
    expect(isActiveAdmin({ role: 'admin', status: 'banned' })).toBe(false);
  });

  it('keeps the resolve-shipment-refund export pointing at the same rule', () => {
    expect(reExported).toBe(isActiveAdmin);
  });
});
