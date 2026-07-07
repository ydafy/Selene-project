import { describe, expect, it } from 'bun:test';

import {
  checkPublishGuard,
  buildInitialUploadProgress,
} from './publishGuard';

describe('checkPublishGuard', () => {
  it('proceeds when all requirements are met', () => {
    const result = checkPublishGuard({
      isPublishing: false,
      publishingLocked: false,
      isOffline: false,
      hasImages: true,
      hasSession: true,
    });

    expect(result).toEqual({ type: 'proceed' });
  });

  it('blocks when already publishing', () => {
    const result = checkPublishGuard({
      isPublishing: true,
      publishingLocked: false,
      isOffline: false,
      hasImages: true,
      hasSession: true,
    });

    expect(result).toEqual({ type: 'blocked', reason: 'already_publishing' });
  });

  it('blocks when the publish lock is held', () => {
    const result = checkPublishGuard({
      isPublishing: false,
      publishingLocked: true,
      isOffline: false,
      hasImages: true,
      hasSession: true,
    });

    expect(result).toEqual({ type: 'blocked', reason: 'already_publishing' });
  });

  it('blocks when offline', () => {
    const result = checkPublishGuard({
      isPublishing: false,
      publishingLocked: false,
      isOffline: true,
      hasImages: true,
      hasSession: true,
    });

    expect(result).toEqual({ type: 'blocked', reason: 'offline' });
  });

  it('blocks when there are no images', () => {
    const result = checkPublishGuard({
      isPublishing: false,
      publishingLocked: false,
      isOffline: false,
      hasImages: false,
      hasSession: true,
    });

    expect(result).toEqual({ type: 'blocked', reason: 'no_images' });
  });

  it('blocks when there is no session', () => {
    const result = checkPublishGuard({
      isPublishing: false,
      publishingLocked: false,
      isOffline: false,
      hasImages: true,
      hasSession: false,
    });

    expect(result).toEqual({ type: 'blocked', reason: 'no_session' });
  });

  it('prefers the first block reason when multiple apply', () => {
    const result = checkPublishGuard({
      isPublishing: true,
      publishingLocked: true,
      isOffline: true,
      hasImages: false,
      hasSession: false,
    });

    expect(result).toEqual({ type: 'blocked', reason: 'already_publishing' });
  });
});

describe('buildInitialUploadProgress', () => {
  it('creates a pending entry for every image uri', () => {
    const progress = buildInitialUploadProgress(['a.jpg', 'b.jpg', 'c.jpg']);

    expect(progress).toEqual({
      'a.jpg': { status: 'pending', progress: 0 },
      'b.jpg': { status: 'pending', progress: 0 },
      'c.jpg': { status: 'pending', progress: 0 },
    });
  });

  it('returns an empty object when there are no images', () => {
    const progress = buildInitialUploadProgress([]);

    expect(progress).toEqual({});
  });
});

