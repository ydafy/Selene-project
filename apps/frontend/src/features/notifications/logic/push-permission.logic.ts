/** Moments with value at which the app offers push (L6). */
export type PushPermissionMoment = 'purchase' | 'favorite' | 'listing';

export type PushPermission = {
  status: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
};

export type PushPermissionPromptDeps = {
  platform: string;
  getPermission: () => Promise<PushPermission>;
  requestPermission: () => Promise<PushPermission>;
  storage: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
  };
  warn: (...args: unknown[]) => void;
};

const promptedKey = (moment: PushPermissionMoment) => `push:prompted:${moment}`;

/**
 * The OS dialog can still be shown. iOS reports this as undetermined; Android
 * 13+ reports denied until it is granted, so `canAskAgain` is the signal.
 */
export const canAskForPush = (permission: PushPermission): boolean =>
  permission.status !== 'granted' && permission.canAskAgain;

/**
 * Decides when to show the push pre-prompt. Each moment is offered at most
 * once per device, and only while the OS dialog is still available, so the
 * one-time iOS dialog is never spent without the user's consent. One
 * pre-prompt at a time: a moment that arrives while another is being decided
 * or is on screen is skipped without its mark, so it is offered later.
 */
export const createPushPermissionPrompt = (deps: PushPermissionPromptDeps) => {
  // True from the start of an offer until its pre-prompt is dismissed, or
  // until the offer ends without showing one.
  let busy = false;

  const decide = async (moment: PushPermissionMoment): Promise<boolean> => {
    if (deps.platform === 'web') return false;
    try {
      if ((await deps.storage.get(promptedKey(moment))) !== null) return false;
      if (!canAskForPush(await deps.getPermission())) return false;
      // Marked when shown: "Not now" also uses up the moment.
      await deps.storage.set(promptedKey(moment), '1');
      return true;
    } catch (error) {
      deps.warn('[PushPermission] Could not offer the prompt:', error);
      return false;
    }
  };

  return {
    /** True when the caller should show the pre-prompt for this moment now. */
    offer: async (moment: PushPermissionMoment): Promise<boolean> => {
      if (busy) return false;
      busy = true;
      const shown = await decide(moment);
      if (!shown) busy = false;
      return shown;
    },
    /** The pre-prompt was closed; the next moment can be offered. */
    dismiss: (): void => {
      busy = false;
    },
    /** Opens the OS dialog; true when the OS granted the permission. */
    request: async (): Promise<boolean> => {
      try {
        return (await deps.requestPermission()).status === 'granted';
      } catch (error) {
        deps.warn('[PushPermission] Permission request failed:', error);
        return false;
      }
    },
  };
};

export type PushSettingsRow = {
  value: 'on' | 'off';
  description: 'description' | 'deniedDescription';
  action: 'request' | 'openSettings';
};

/**
 * The Settings row mirrors the OS permission. An app cannot revoke its own
 * permission, so turning push off, or on after a denial, happens in the OS.
 */
export const pushSettingsRow = (
  permission: PushPermission,
): PushSettingsRow => {
  if (permission.status === 'granted') {
    return { value: 'on', description: 'description', action: 'openSettings' };
  }
  if (canAskForPush(permission)) {
    return { value: 'off', description: 'description', action: 'request' };
  }
  return {
    value: 'off',
    description: 'deniedDescription',
    action: 'openSettings',
  };
};
