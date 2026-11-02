export type PushPlatform = 'ios' | 'android';

/** Small key-value store that survives an app restart. */
export type PushStorage = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

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
  storage: PushStorage;
  /**
   * Each external call (native module, storage, RPC) fails after this;
   * defaults to 15 s. The queue stays strictly serial, so a late response
   * can never change state that a later step already wrote.
   */
  stepTimeoutMs?: number;
  warn: (...args: unknown[]) => void;
};

const STEP_TIMEOUT_MS = 15000;
const REGISTERED_KEY = 'push:registeredToken';
const PENDING_KEY = 'push:pendingUnregister';

const isPushPlatform = (platform: string): platform is PushPlatform =>
  platform === 'ios' || platform === 'android';

/** True when requests can go out; unknown reachability trusts the connection. */
export const isNetworkReachable = (state: {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}): boolean => state.isInternetReachable ?? state.isConnected === true;

/**
 * Registers this device's Expo push token for the signed-in user. Every
 * failure is logged and swallowed: push must never block or break the UI.
 * Logs carry the error object only, never a token value.
 */
export const createPushRegistrar = (deps: PushRegistrarDeps) => {
  const stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
  let lastToken: string | null = null;
  let inFlight: Promise<void> = Promise.resolve();
  let currentUserId: string | undefined;
  // After sign-out starts, the signed-out user is not registered again until
  // the session changes or the sign-out finishes, so a queued registration
  // cannot undo the unregister.
  let signedOutUserId: string | undefined;
  // The last register call got no answer: the server may still apply it,
  // even after a later unregister, so that unregister keeps its retry.
  let registerUnanswered = false;

  // A call that does not answer in time counts as failed; the step then
  // follows its failure path and the queue moves on.
  const limit = async <T>(call: () => Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        call(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Push call timed out')),
            stepTimeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  const runStep = async (step: () => Promise<void>): Promise<void> => {
    try {
      await step();
    } catch (error) {
      deps.warn('[push] Step failed:', error);
    }
  };

  const enqueue = (step: () => Promise<void>): Promise<void> => {
    inFlight = inFlight.then(() => runStep(step));
    return inFlight;
  };

  // Storage trouble must never stop the token calls themselves.
  const store = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await limit(work);
    } catch (error) {
      deps.warn('[push] Storage failed:', error);
    }
  };

  const readStored = async (key: string): Promise<string | null> => {
    try {
      return await limit(() => deps.storage.get(key));
    } catch (error) {
      deps.warn('[push] Storage failed:', error);
      return null;
    }
  };

  const flushOnce = async (): Promise<void> => {
    const pending = await readStored(PENDING_KEY);
    if (!pending) return;
    try {
      await limit(() => deps.unregisterToken(pending));
      registerUnanswered = false;
      await store(() => deps.storage.remove(PENDING_KEY));
    } catch (error) {
      deps.warn('[push] Pending unregister failed:', error);
    }
  };

  /**
   * Retries an unregister that a failed or timed-out sign-out left behind,
   * then registers for the current session. Callers retry through here (also
   * when the network returns), so a retry never ends with the token removed
   * from a signed-in account.
   */
  const register = (userId: string | undefined): Promise<void> => {
    currentUserId = userId;
    void enqueue(flushOnce);
    return enqueue(() => registerOnce(userId));
  };

  const registerOnce = async (userId: string | undefined): Promise<void> => {
    const { platform } = deps;
    if (!isPushPlatform(platform)) return;
    if (userId !== signedOutUserId) signedOutUserId = undefined;
    try {
      if (platform === 'android') await limit(deps.createChannels);
      if (!userId || userId === signedOutUserId) return;
      if (!(await limit(deps.hasPermission))) return;
      const projectId = deps.getProjectId();
      if (!projectId) {
        deps.warn('[push] Missing EAS project id; skipping registration');
        return;
      }
      const token = await limit(() => deps.getExpoPushToken(projectId));
      // Known before the call: the server may hold it even if the answer is
      // lost, and a later sign-out must still remove it.
      lastToken = token;
      await store(() => deps.storage.set(REGISTERED_KEY, token));
      registerUnanswered = true;
      await limit(() => deps.registerToken(token, platform));
      registerUnanswered = false;
      // The token now belongs to this account; a pending unregister of it
      // would remove that registration. Only while the session is this one.
      const stillSignedIn =
        userId === currentUserId && userId !== signedOutUserId;
      if (stillSignedIn && (await readStored(PENDING_KEY)) === token) {
        await store(() => deps.storage.remove(PENDING_KEY));
      }
    } catch (error) {
      deps.warn('[push] Registration failed:', error);
    }
  };

  // Sign-out runs after any registration in progress, so its token is not
  // left on the account after the session ends.
  const unregister = (): Promise<void> => {
    signedOutUserId = currentUserId;
    // Marked at once, outside the queue: a step that is still running must
    // not delay the mark past the sign-out time limit.
    const marked = markPending();
    return enqueue(async () => {
      await marked;
      await unregisterOnce();
    });
  };

  const markPending = async (): Promise<void> => {
    const token = lastToken ?? (await readStored(REGISTERED_KEY));
    if (token) await store(() => deps.storage.set(PENDING_KEY, token));
  };

  const unregisterOnce = async (): Promise<void> => {
    const token = lastToken ?? (await readStored(REGISTERED_KEY));
    if (!token) return;
    // Marked first so a failure or a sign-out time limit leaves it to retry.
    await store(() => deps.storage.set(PENDING_KEY, token));
    try {
      await limit(() => deps.unregisterToken(token));
      lastToken = null;
      if (!registerUnanswered) {
        await store(() => deps.storage.remove(PENDING_KEY));
      }
      await store(() => deps.storage.remove(REGISTERED_KEY));
    } catch (error) {
      deps.warn('[push] Unregister failed:', error);
    }
  };

  /** The sign-out ended (success or failure); a continuing session registers again. */
  const signOutFinished = (): void => {
    signedOutUserId = undefined;
  };

  return { register, unregister, signOutFinished };
};
