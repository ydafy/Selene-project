import { describe, expect, it } from 'bun:test';

import {
  createPushTapRouter,
  FOREGROUND_PUSH_BEHAVIOR,
  readPushTap,
  type PushTap,
  type PushTapResponse,
} from './push-tap.logic';

const DEFAULT_ACTION = 'expo.default';
const ID = '8a3c2e1f-4b5d-4c6e-8f70-123456789abc';
const OTHER_ID = '9b4d3f20-5c6e-4d7f-9081-23456789abcd';

const response = (
  overrides: {
    identifier?: string;
    actionIdentifier?: string;
    data?: unknown;
  } = {},
): PushTapResponse => ({
  actionIdentifier: overrides.actionIdentifier ?? DEFAULT_ACTION,
  notification: {
    request: {
      identifier: overrides.identifier ?? 'request-1',
      content: {
        data:
          'data' in overrides
            ? overrides.data
            : {
                notification_id: ID,
                action_path: '/profile/orders/1',
                event_kind: 'shipment.delivered',
              },
      },
    },
  },
});

describe('readPushTap', () => {
  it('reads the notice id and its path from a default tap', () => {
    expect(readPushTap(response(), DEFAULT_ACTION)).toEqual({
      id: ID,
      action_path: '/profile/orders/1',
    });
  });

  it('keeps a null path, which opens the inbox', () => {
    expect(
      readPushTap(
        response({ data: { notification_id: ID, action_path: null } }),
        DEFAULT_ACTION,
      ),
    ).toEqual({ id: ID, action_path: null });
  });

  it('ignores an action other than the default tap', () => {
    expect(
      readPushTap(response({ actionIdentifier: 'reply' }), DEFAULT_ACTION),
    ).toBeNull();
  });

  it('drops data that is not a notice from the server', () => {
    const invalid: unknown[] = [
      undefined,
      null,
      'text',
      {},
      { notification_id: 'not-a-uuid', action_path: '/profile/orders/1' },
      { notification_id: 42, action_path: '/profile/orders/1' },
      { notification_id: ID },
      { notification_id: ID, action_path: 7 },
    ];
    for (const data of invalid) {
      expect(readPushTap(response({ data }), DEFAULT_ACTION)).toBeNull();
    }
  });
});

const setup = (launch: PushTapResponse | null = null) => {
  const pressed: PushTap[] = [];
  const events: string[] = [];
  const warnings: unknown[][] = [];
  const press = async (tap: PushTap) => {
    pressed.push(tap);
  };
  const router = createPushTapRouter({
    defaultAction: DEFAULT_ACTION,
    getLaunchResponse: () => {
      events.push('launch-read');
      return launch;
    },
    clearLastResponse: () => {
      events.push('clear');
    },
    warn: (...args) => warnings.push(args),
  });
  return { router, pressed, events, warnings, press };
};

describe('createPushTapRouter', () => {
  it('presses a warm tap once the app is ready and signed in', () => {
    const { router, pressed, events, press } = setup();
    router.update({ ready: true, press });
    router.receive(response());
    expect(pressed).toEqual([{ id: ID, action_path: '/profile/orders/1' }]);
    expect(events).toEqual(['launch-read', 'clear']);
  });

  it('holds a tap until the navigator and the session are ready', () => {
    const { router, pressed, events, press } = setup();
    router.receive(response());
    router.update({ ready: false, press });
    expect(pressed).toEqual([]);
    expect(events).not.toContain('clear');
    router.update({ ready: true, press });
    expect(pressed).toHaveLength(1);
    expect(events).toContain('clear');
  });

  it('presses the tap that launched the app', () => {
    const { router, pressed, press } = setup(response());
    router.update({ ready: true, press });
    expect(pressed).toEqual([{ id: ID, action_path: '/profile/orders/1' }]);
  });

  it('presses a launch tap delivered again by the listener only once', () => {
    const { router, pressed, press } = setup(response());
    router.update({ ready: true, press });
    router.receive(response());
    router.update({ ready: true, press });
    expect(pressed).toHaveLength(1);
  });

  it('presses a later tap on another push', () => {
    const { router, pressed, press } = setup();
    router.update({ ready: true, press });
    router.receive(response());
    router.receive(
      response({
        identifier: 'request-2',
        data: { notification_id: OTHER_ID, action_path: null },
      }),
    );
    expect(pressed).toEqual([
      { id: ID, action_path: '/profile/orders/1' },
      { id: OTHER_ID, action_path: null },
    ]);
  });

  it('does not navigate without a session, and does not keep the tap', () => {
    const { router, pressed, events, press } = setup(response());
    router.update({ ready: true, press: null });
    expect(pressed).toEqual([]);
    expect(events).toContain('clear');
    router.update({ ready: true, press });
    expect(pressed).toEqual([]);
  });

  it('clears and drops a tap with invalid data', () => {
    const { router, pressed, events, press } = setup();
    router.update({ ready: true, press });
    router.receive(response({ data: { notification_id: 'bad' } }));
    expect(pressed).toEqual([]);
    expect(events).toEqual(['launch-read', 'clear']);
  });

  it('a newer tap replaces one still waiting', () => {
    const { router, pressed, press } = setup();
    router.receive(response());
    router.receive(
      response({
        identifier: 'request-2',
        data: { notification_id: OTHER_ID, action_path: null },
      }),
    );
    router.update({ ready: true, press });
    expect(pressed).toEqual([{ id: OTHER_ID, action_path: null }]);
  });

  it('logs a failed press without the push data', async () => {
    const { router, warnings } = setup();
    const error = new Error('navigation failed');
    router.update({
      ready: true,
      press: async () => {
        throw error;
      },
    });
    router.receive(response());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warnings).toEqual([['[PushTap] Press failed:', error]]);
  });

  it('reports a tap launch once, so only that launch skips the digest', () => {
    const { router } = setup(response());
    expect(router.consumeLaunchTap()).toBe(true);
    expect(router.consumeLaunchTap()).toBe(false);
  });

  it('a launch without a valid tap does not skip the digest', () => {
    expect(setup().router.consumeLaunchTap()).toBe(false);
    expect(
      setup(response({ actionIdentifier: 'reply' })).router.consumeLaunchTap(),
    ).toBe(false);
  });

  it('reads the launch response only once', () => {
    const { router, events, press } = setup(response());
    router.consumeLaunchTap();
    router.update({ ready: true, press });
    router.update({ ready: false, press });
    expect(events.filter((event) => event === 'launch-read')).toHaveLength(1);
  });
});

describe('FOREGROUND_PUSH_BEHAVIOR', () => {
  it('shows nothing while the app is open; the inbox updates by realtime', () => {
    expect(FOREGROUND_PUSH_BEHAVIOR).toEqual({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });
});
