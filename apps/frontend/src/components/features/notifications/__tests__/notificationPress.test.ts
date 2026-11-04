import { describe, expect, it, mock } from 'bun:test';

import { createNotificationPressHandler } from '../notificationPress';

const notif = { id: 'n1', action_path: '/sell/onboarding' };

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createNotificationPressHandler', () => {
  it('navigates without waiting for the read mark to finish', async () => {
    const read = deferred();
    const markAsRead = mock(() => read.promise);
    const navigate = mock(async () => {});
    const press = createNotificationPressHandler({ markAsRead, navigate });

    await press(notif);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/sell/onboarding');
    expect(markAsRead).toHaveBeenCalledTimes(1);
    expect(markAsRead).toHaveBeenCalledWith('n1');
    read.resolve();
  });

  it('ignores a second tap while the first navigation is in flight', async () => {
    const nav = deferred();
    const markAsRead = mock(async () => {});
    const navigate = mock(() => nav.promise);
    const press = createNotificationPressHandler({ markAsRead, navigate });

    const first = press(notif);
    await press(notif);
    nav.resolve();
    await first;

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(markAsRead).toHaveBeenCalledTimes(1);
  });

  it('accepts a new tap once the previous navigation finished', async () => {
    const markAsRead = mock(async () => {});
    const navigate = mock(async () => {});
    const press = createNotificationPressHandler({ markAsRead, navigate });

    await press(notif);
    await press(notif);

    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('releases the guard when navigation fails', async () => {
    const markAsRead = mock(async () => {});
    const navigate = mock(async () => {
      throw new Error('nav failed');
    });
    const press = createNotificationPressHandler({ markAsRead, navigate });

    await expect(press(notif)).rejects.toThrow('nav failed');
    await expect(press(notif)).rejects.toThrow('nav failed');

    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('still navigates and re-arms when marking as read throws synchronously', async () => {
    const markAsRead = mock((): Promise<void> => {
      throw new Error('sync failure');
    });
    const navigate = mock(async () => {});
    const press = createNotificationPressHandler({ markAsRead, navigate });

    await press(notif);
    await press(notif);

    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('still navigates when marking as read fails', async () => {
    const markAsRead = mock(async () => {
      throw new Error('offline');
    });
    const navigate = mock(async () => {});
    const press = createNotificationPressHandler({ markAsRead, navigate });

    await press(notif);
    await Promise.resolve();

    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
