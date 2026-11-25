import { expect, mock, test } from 'bun:test';
import React from 'react';

// Bun shares its module registry across suite files; a child isolates the RN mock
// from unrelated tests that have already imported the native entrypoint.
if (process.env.SELENE_PAYMENT_METHODS_SHEET_MOUNT_CHILD !== '1') {
  test('mounts PaymentMethodsSheet in an isolated Bun process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_PAYMENT_METHODS_SHEET_MOUNT_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (child.exitCode !== 0)
      throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

  type AlertButton = { text: string; onPress?: () => void };
  const events: string[] = [];
  const alertButtons: AlertButton[][] = [];
  const replies: (() => Promise<unknown>)[] = [];

  const host =
    (name: string) =>
    ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(name, props, children);

  mock.module('react-native', () => ({
    Alert: {
      alert: (_title: string, _message: string, buttons: AlertButton[]) => {
        events.push('alert');
        alertButtons.push(buttons);
      },
    },
  }));
  mock.module('@stripe/stripe-react-native', () => ({
    CustomerSheet: { Component: host('CustomerSheet') },
  }));
  mock.module('react-native-toast-message', () => ({
    default: { show: () => {} },
  }));
  mock.module('@shopify/restyle', () => ({
    useTheme: () => ({ colors: {} }),
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
  }));
  mock.module('@/shared/lib/edge-client', () => ({
    invokeEdge: () => {
      const reply = replies.shift();
      if (!reply) throw new Error('unexpected invokeEdge');
      return reply();
    },
  }));

  const { act, render } = await import('@testing-library/react-native');
  const { PaymentMethodsSheet } = await import('./payment-methods-sheet');

  type View = Awaited<ReturnType<typeof render>>;
  const sheets = (view: View) =>
    view.container.queryAll((node) => node.type === 'CustomerSheet');
  const flush = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  // Each reply waits for `release`, so the test sees the fetch in flight.
  let release: () => void = () => {};
  const gate = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const answerSession = () =>
    replies.push(
      async () => {
        await gate();
        return { customerId: 'cus_1', customerSessionClientSecret: 'cs' };
      },
      async () => ({ setupIntentClientSecret: 'seti_secret' }),
    );
  const failSession = () =>
    replies.push(async () => {
      await gate();
      throw new Error('CUSTOMER_SESSION_FAILED');
    });
  const answer = () =>
    act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  test('reports preparing until the session is ready, and not while the sheet is open', async () => {
    events.length = 0;
    answerSession();
    const onPreparingChange = (preparing: boolean) =>
      events.push(`preparing:${preparing}`);

    const view = await render(
      <PaymentMethodsSheet
        visible
        onClose={() => {}}
        onPreparingChange={onPreparingChange}
      />,
    );
    expect(events).toEqual(['preparing:true']);
    expect(sheets(view)).toHaveLength(0);

    await answer();
    expect(events).toEqual(['preparing:true', 'preparing:false']);
    expect(sheets(view)).toHaveLength(1);
  });

  test('stops preparing before the retry alert, and a retry prepares again', async () => {
    events.length = 0;
    alertButtons.length = 0;
    failSession();
    const onPreparingChange = (preparing: boolean) =>
      events.push(`preparing:${preparing}`);

    const view = await render(
      <PaymentMethodsSheet
        visible
        onClose={() => {}}
        onPreparingChange={onPreparingChange}
      />,
    );
    expect(events).toEqual(['preparing:true']);
    await answer();
    expect(events).toEqual(['preparing:true', 'preparing:false', 'alert']);
    expect(sheets(view)).toHaveLength(0);

    answerSession();
    const retry = alertButtons[0].find(
      (button) => button.text === 'paymentMethods.retry',
    )!;
    await act(async () => retry.onPress!());
    expect(events.slice(3)).toEqual(['preparing:true']);

    await answer();
    expect(events.slice(3)).toEqual(['preparing:true', 'preparing:false']);
    expect(sheets(view)).toHaveLength(1);
  });

  test('reports nothing while it is not visible', async () => {
    events.length = 0;
    await render(
      <PaymentMethodsSheet
        visible={false}
        onClose={() => {}}
        onPreparingChange={(preparing) => events.push(`preparing:${preparing}`)}
      />,
    );
    await flush();
    expect(events).toEqual([]);
  });
}
