import { describe, expect, it } from 'bun:test';

import { adminAccessMessage, evaluateAdminAccess } from './adminAccess';

describe('evaluateAdminAccess', () => {
  it('allows an active admin', () => {
    expect(evaluateAdminAccess({ role: 'admin', status: 'active' })).toEqual({
      allowed: true,
    });
  });

  it('denies a missing profile', () => {
    expect(evaluateAdminAccess(null)).toEqual({
      allowed: false,
      reason: 'missing_profile',
    });
    expect(evaluateAdminAccess(undefined)).toEqual({
      allowed: false,
      reason: 'missing_profile',
    });
  });

  it('denies non-admin roles even when active', () => {
    for (const role of ['user', 'seller', '', null]) {
      expect(evaluateAdminAccess({ role, status: 'active' })).toEqual({
        allowed: false,
        reason: 'not_admin',
      });
    }
  });

  it('denies suspended and banned admins', () => {
    for (const status of ['suspended', 'banned']) {
      expect(evaluateAdminAccess({ role: 'admin', status })).toEqual({
        allowed: false,
        reason: 'inactive',
      });
    }
  });

  it('denies an admin with an unexpected or null status', () => {
    for (const status of [null, undefined, '', 'ACTIVE', 'pending']) {
      expect(evaluateAdminAccess({ role: 'admin', status })).toEqual({
        allowed: false,
        reason: 'inactive',
      });
    }
  });

  it('has a distinct message per denial reason', () => {
    const messages = new Set([
      adminAccessMessage('missing_profile'),
      adminAccessMessage('not_admin'),
      adminAccessMessage('inactive'),
    ]);
    expect(messages.size).toBe(3);
  });
});
