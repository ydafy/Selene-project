export type PushPlatform = 'ios' | 'android';

export type PushRegistrarDeps = {
  platform: string;
  getProjectId: () => string | undefined;
  /** Android only. Must finish before any token is requested. */
  createChannels: () => Promise<void>;
  /** Reads the current permission; never prompts (the pre-prompt is T10). */
  hasPermission: () => Promise<boolean>;
  getExpoPushToken: (projectId: string) => Promise<string>;
  registerToken: (token: string, platform: PushPlatform) => Promise<void>;
  unregisterToken: (token: string) => Promise<void>;
  warn: (...args: unknown[]) => void;
};

const isPushPlatform = (platform: string): platform is PushPlatform =>
  platform === 'ios' || platform === 'android';

/**
 * Registers this device's Expo push token for the signed-in user. Every
 * failure is logged and swallowed: push must never block or break the UI.
 */
export const createPushRegistrar = (deps: PushRegistrarDeps) => {
  let lastToken: string | null = null;
  let inFlight: Promise<void> = Promise.resolve();
  let currentUserId: string | undefined;
  // After sign-out starts, the signed-out user is not registered again until
  // the session changes, so a queued registration cannot undo the unregister.
  let signedOutUserId: string | undefined;

  const enqueue = (step: () => Promise<void>): Promise<void> => {
    inFlight = inFlight.then(step);
    return inFlight;
  };

  const register = (userId: string | undefined): Promise<void> => {
    currentUserId = userId;
    return enqueue(() => registerOnce(userId));
  };

  const registerOnce = async (userId: string | undefined): Promise<void> => {
    const { platform } = deps;
    if (!isPushPlatform(platform)) return;
    if (userId !== signedOutUserId) signedOutUserId = undefined;
    try {
      if (platform === 'android') await deps.createChannels();
      if (!userId || userId === signedOutUserId) return;
      if (!(await deps.hasPermission())) return;
      const projectId = deps.getProjectId();
      if (!projectId) {
        deps.warn('[push] Missing EAS project id; skipping registration');
        return;
      }
      const token = await deps.getExpoPushToken(projectId);
      await deps.registerToken(token, platform);
      lastToken = token;
    } catch (error) {
      deps.warn('[push] Registration failed:', error);
    }
  };

  // Sign-out runs after any registration in progress, so its token is not
  // left on the account after the session ends.
  const unregister = (): Promise<void> => {
    signedOutUserId = currentUserId;
    return enqueue(unregisterOnce);
  };

  const unregisterOnce = async (): Promise<void> => {
    const token = lastToken;
    if (!token) return;
    try {
      await deps.unregisterToken(token);
      lastToken = null;
    } catch (error) {
      deps.warn('[push] Unregister failed:', error);
    }
  };

  return { register, unregister };
};
