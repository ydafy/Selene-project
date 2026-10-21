import { describe, expect, it } from 'bun:test';

import {
  INITIAL_STATUS_STATE,
  applyStatusLoad,
  createLatestRequest,
  shouldReloadStatusOnResume,
  syncStatusOwner,
  type StatusState,
} from './sessionStatus.logic';

const bannedA: StatusState = {
  userId: 'user-a',
  status: 'banned',
  reason: 'fraud',
};

describe('applyStatusLoad', () => {
  it('applies a loaded status that belongs to the current user', () => {
    const next = applyStatusLoad(INITIAL_STATUS_STATE, 'user-a', 'user-a', {
      ok: true,
      status: 'suspended',
      reason: 'review',
    });
    expect(next).toEqual({
      userId: 'user-a',
      status: 'suspended',
      reason: 'review',
    });
  });

  it('defaults a null status to active without a reason', () => {
    const next = applyStatusLoad(INITIAL_STATUS_STATE, 'user-a', 'user-a', {
      ok: true,
      status: null,
      reason: null,
    });
    expect(next).toEqual({ userId: 'user-a', status: 'active', reason: null });
  });

  it('discards a late response for a previous user', () => {
    const current: StatusState = {
      userId: 'user-b',
      status: 'active',
      reason: null,
    };
    const next = applyStatusLoad(current, 'user-a', 'user-b', {
      ok: true,
      status: 'banned',
      reason: 'fraud',
    });
    expect(next).toBe(current);
  });

  it('discards a late response after sign-out', () => {
    const next = applyStatusLoad(INITIAL_STATUS_STATE, 'user-a', null, {
      ok: true,
      status: 'banned',
      reason: 'fraud',
    });
    expect(next).toBe(INITIAL_STATUS_STATE);
  });

  it('keeps the last known status of the same user when the load fails', () => {
    expect(applyStatusLoad(bannedA, 'user-a', 'user-a', { ok: false })).toBe(
      bannedA,
    );
  });

  it('never carries another user status when the load fails', () => {
    const next = applyStatusLoad(bannedA, 'user-b', 'user-b', { ok: false });
    expect(next).toEqual({ userId: 'user-b', status: 'active', reason: null });
  });
});

describe('syncStatusOwner', () => {
  it('keeps the state while the user is unchanged', () => {
    expect(syncStatusOwner(bannedA, 'user-a')).toBe(bannedA);
  });

  it('resets the state when the user changes or signs out', () => {
    expect(syncStatusOwner(bannedA, 'user-b')).toBe(INITIAL_STATUS_STATE);
    expect(syncStatusOwner(bannedA, null)).toBe(INITIAL_STATUS_STATE);
  });
});

describe('shouldReloadStatusOnResume', () => {
  it('reloads only when the app becomes active with a session', () => {
    expect(shouldReloadStatusOnResume('active', 'user-a')).toBe(true);
    expect(shouldReloadStatusOnResume('active', null)).toBe(false);
    expect(shouldReloadStatusOnResume('background', 'user-a')).toBe(false);
    expect(shouldReloadStatusOnResume('inactive', 'user-a')).toBe(false);
  });
});

describe('createLatestRequest', () => {
  it('only the most recent status load may be applied', () => {
    const requests = createLatestRequest();
    const older = requests.begin();
    const newer = requests.begin();
    expect(requests.isLatest(older)).toBe(false);
    expect(requests.isLatest(newer)).toBe(true);
  });

  it('an older banned response cannot overwrite a newer active one', () => {
    const requests = createLatestRequest();
    let state: StatusState = INITIAL_STATUS_STATE;
    const apply = (seq: number, status: 'active' | 'banned') => {
      if (!requests.isLatest(seq)) return;
      state = applyStatusLoad(state, 'u1', 'u1', { ok: true, status, reason: null });
    };

    const older = requests.begin();
    const newer = requests.begin();
    apply(newer, 'active');
    apply(older, 'banned');

    expect(state.status).toBe('active');
  });
});
