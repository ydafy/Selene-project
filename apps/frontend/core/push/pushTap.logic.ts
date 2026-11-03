/** The notice a push tap opens: its inbox row and the path it links to. */
export type PushTap = { id: string; action_path: string | null };

/** The fields of an `expo-notifications` response that a tap needs. */
export type PushTapResponse = {
  actionIdentifier: string;
  notification: {
    request: { identifier: string; content: { data?: unknown } };
  };
};

/**
 * A push that arrives while the app is open shows nothing: no banner, no list
 * entry, no sound, no badge. The inbox already updates through realtime.
 */
export const FOREGROUND_PUSH_BEHAVIOR = {
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: false,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the notice from a tap on a push sent by `dispatch-push`. The data
 * comes from outside the app, so anything but the default tap on a
 * well-formed notice is dropped.
 */
export function readPushTap(
  response: PushTapResponse,
  defaultAction: string,
): PushTap | null {
  if (response.actionIdentifier !== defaultAction) return null;
  const data = response.notification.request.content.data;
  if (typeof data !== 'object' || data === null) return null;
  const { notification_id: id, action_path: actionPath } = data as Record<
    string,
    unknown
  >;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (actionPath !== null && typeof actionPath !== 'string') return null;
  return { id, action_path: actionPath };
}

export type PushTapRouterDeps = {
  defaultAction: string;
  /** The tap that launched the app, if any (`getLastNotificationResponse`). */
  getLaunchResponse: () => PushTapResponse | null;
  clearLastResponse: () => void;
  warn: (...args: unknown[]) => void;
};

export type PushTapState = {
  /** The navigator is mounted and the session has loaded. */
  ready: boolean;
  /** Opens a notice; null while signed out. */
  press: ((tap: PushTap) => Promise<void>) | null;
};

/**
 * Sends each push tap through the inbox press once. A tap waits until the app
 * can navigate; one that arrives while signed out is dropped, and the notice
 * stays in the inbox. A cold start can deliver the same tap twice (launch
 * response and listener), so taps are keyed by their request identifier.
 */
export function createPushTapRouter(deps: PushTapRouterDeps) {
  const seen = new Set<string>();
  let launchRead = false;
  let launchWasTap = false;
  let pending: PushTap | null = null;
  let state: PushTapState = { ready: false, press: null };

  const flush = () => {
    if (!pending || !state.ready) return;
    const tap = pending;
    pending = null;
    deps.clearLastResponse();
    if (!state.press) return;
    state.press(tap).catch((error: unknown) => {
      deps.warn('[PushTap] Press failed:', error);
    });
  };

  const accept = (response: PushTapResponse): PushTap | null => {
    const key = response.notification.request.identifier;
    if (seen.has(key)) return null;
    seen.add(key);
    const tap = readPushTap(response, deps.defaultAction);
    if (!tap) {
      deps.clearLastResponse();
      return null;
    }
    pending = tap;
    return tap;
  };

  const readLaunch = () => {
    if (launchRead) return;
    launchRead = true;
    const launch = deps.getLaunchResponse();
    if (launch) launchWasTap = accept(launch) !== null;
  };

  return {
    receive(response: PushTapResponse): void {
      readLaunch();
      accept(response);
      flush();
    },
    update(next: PushTapState): void {
      readLaunch();
      state = next;
      flush();
    },
    /** True once when a tap launched the app, so that launch skips the digest. */
    consumeLaunchTap(): boolean {
      readLaunch();
      const wasTap = launchWasTap;
      launchWasTap = false;
      return wasTap;
    },
  };
}
