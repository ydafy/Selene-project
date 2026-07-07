export type ImageUploadState = {
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: number;
};

export type PublishGuardResult =
  | { type: 'proceed' }
  | { type: 'blocked'; reason: PublishBlockReason };

export type PublishBlockReason =
  | 'already_publishing'
  | 'offline'
  | 'no_images'
  | 'no_session';

export type PublishGuardInput = {
  isPublishing: boolean;
  publishingLocked: boolean;
  isOffline: boolean;
  hasImages: boolean;
  hasSession: boolean;
};

/**
 * Pure guard that decides whether a publish attempt should proceed.
 * Order mirrors the original hook checks: lock, session, images, offline.
 */
export const checkPublishGuard = ({
  isPublishing,
  publishingLocked,
  isOffline,
  hasImages,
  hasSession,
}: PublishGuardInput): PublishGuardResult => {
  if (isPublishing || publishingLocked) {
    return { type: 'blocked', reason: 'already_publishing' };
  }
  if (!hasSession) {
    return { type: 'blocked', reason: 'no_session' };
  }
  if (!hasImages) {
    return { type: 'blocked', reason: 'no_images' };
  }
  if (isOffline) {
    return { type: 'blocked', reason: 'offline' };
  }
  return { type: 'proceed' };
};

/**
 * Builds the initial pending state for every image uri.
 */
export const buildInitialUploadProgress = (
  uris: string[],
): Record<string, ImageUploadState> => {
  const progress: Record<string, ImageUploadState> = {};
  for (const uri of uris) {
    progress[uri] = { status: 'pending', progress: 0 };
  }
  return progress;
};


