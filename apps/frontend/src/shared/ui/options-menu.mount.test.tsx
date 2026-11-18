import { expect, mock, test } from 'bun:test';
import React from 'react';

// Bun shares its module registry across suite files; a child isolates the RN mocks
// from unrelated tests that have already imported the native entrypoint.
if (process.env.SELENE_OPTIONS_MENU_MOUNT_CHILD !== '1') {
  test('mounts OptionsMenu in an isolated Bun process', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_OPTIONS_MENU_MOUNT_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (child.exitCode !== 0)
      throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

  const host =
    (name: string) =>
    ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(name, props, children);

  mock.module('react-native', () => ({
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
    Modal: ({
      visible,
      children,
      ...props
    }: React.PropsWithChildren<{ visible: boolean }>) =>
      visible ? React.createElement('Modal', props, children) : null,
    ScrollView: host('ScrollView'),
    TouchableOpacity: host('TouchableOpacity'),
    useWindowDimensions: () => ({ width: 400, height: 800 }),
  }));
  mock.module('react-native-paper', () => ({
    IconButton: host('IconButton'),
    Divider: host('Divider'),
  }));
  mock.module('@shopify/restyle', () => ({
    useTheme: () => ({
      colors: { textPrimary: '#t', textSecondary: '#s', primary: '#p' },
      spacing: { m: 16, s: 8 },
    }),
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
  }));
  mock.module('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
  }));
  const show = mock<(options: Record<string, unknown>) => void>(() => {});
  mock.module('react-native-toast-message', () => ({ default: { show } }));
  mock.module('@react-native-vector-icons/material-design-icons', () => ({
    default: host('Icon'),
  }));
  mock.module('@/shared/theme/tokens', () => ({
    colors: { backdrop: '#b', shadow: '#000' },
  }));
  mock.module('@/shared/ui/base', () => ({
    Box: host('Box'),
    Text: host('Text'),
  }));
  mock.module('@/shared/ui/feedback/confirm-dialog', () => ({
    ConfirmDialog: ({
      visible,
      children,
      ...props
    }: React.PropsWithChildren<{ visible: boolean }>) =>
      visible ? React.createElement('ConfirmDialog', props, children) : null,
  }));
  mock.module('@/shared/ui/form/form-text-input', () => ({
    FormTextInput: host('FormTextInput'),
  }));
  mock.module('@/shared/lib/auth/auth-provider', () => ({
    useAuthContext: () => ({ session: { user: { id: 'me' } } }),
  }));
  let outcome = 'success';
  const reportEntity = mock<
    (report: Record<string, unknown>) => Promise<string>
  >(async () => outcome);
  const blockUser = mock(async () => ({ error: null }));
  mock.module('@/shared/hooks/use-moderation', () => ({
    useModeration: () => ({ reportEntity, blockUser, loading: false }),
  }));

  const { act, render } = await import('@testing-library/react-native');
  const { OptionsMenu } = await import('./options-menu');

  type View = Awaited<ReturnType<typeof render>>;
  const all = (view: View, type: string) =>
    view.container.queryAll((node) => node.type === type);
  const textOf = (node: { props: { children?: unknown } }) =>
    String(node.props.children);
  // The pressable whose subtree renders the given text.
  const pressableWithText = (view: View, text: string) => {
    const found = all(view, 'TouchableOpacity').filter((node) =>
      node
        .queryAll((child) => child.type === 'Text')
        .some((child) => textOf(child) === text),
    );
    expect(found.length).toBeGreaterThan(0);
    return found[found.length - 1];
  };
  const dialog = (view: View) => {
    const found = all(view, 'ConfirmDialog');
    expect(found).toHaveLength(1);
    return found[0];
  };
  const press = async (node: { props: Record<string, unknown> }) =>
    act(async () => (node.props.onPress as () => unknown)());
  const openReport = async (view: View, label: string) => {
    await press(all(view, 'IconButton')[0]);
    await press(pressableWithText(view, label));
    // The menu waits for its modal to close before it opens the dialog.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 260)));
  };

  test('reporting a user asks for a reason and details and says user, not listing', async () => {
    show.mockClear();
    reportEntity.mockClear();
    outcome = 'already_reported';
    const view = await render(
      <OptionsMenu targetId="u1" sellerId="u1" context="user" />,
    );
    await openReport(view, 'product:report.user.action');

    expect(dialog(view).props.title).toBe('product:report.user.title');
    // Nothing to send until a reason is chosen.
    expect(dialog(view).props.disabled).toBe(true);
    const reasonTexts = all(view, 'Text')
      .map(textOf)
      .filter((text) => text.startsWith('product:report.reasons.'));
    expect(reasonTexts).toEqual([
      'product:report.reasons.fraud',
      'product:report.reasons.counterfeit_or_misdescribed',
      'product:report.reasons.prohibited_item',
      'product:report.reasons.offensive_content',
      'product:report.reasons.harassment',
      'product:report.reasons.spam',
      'product:report.reasons.other',
    ]);

    await press(pressableWithText(view, 'product:report.reasons.harassment'));
    expect(dialog(view).props.disabled).toBe(false);
    const details = all(view, 'FormTextInput')[0];
    expect(details.props.maxLength).toBe(1000);
    await act(async () =>
      (details.props.onChangeText as (text: string) => void)('rude messages'),
    );

    await act(async () => (dialog(view).props.onConfirm as () => unknown)());
    expect(reportEntity).toHaveBeenCalledTimes(1);
    expect(reportEntity.mock.calls[0][0]).toEqual({
      target: { context: 'user', id: 'u1' },
      reason: 'harassment',
      details: 'rude messages',
    });
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0]).toMatchObject({
      type: 'info',
      text1: 'product:report.user.alreadyTitle',
      text2: 'product:report.user.alreadyMsg',
    });
    expect(all(view, 'ConfirmDialog')).toHaveLength(0);
    await view.unmount();
  });

  test('a listing report shows the success toast and closes', async () => {
    show.mockClear();
    reportEntity.mockClear();
    outcome = 'success';
    const view = await render(
      <OptionsMenu targetId="p1" sellerId="s1" context="product" />,
    );
    await openReport(view, 'product:report.product.action');
    expect(dialog(view).props.title).toBe('product:report.product.title');
    await press(pressableWithText(view, 'product:report.reasons.fraud'));
    await act(async () => (dialog(view).props.onConfirm as () => unknown)());

    expect(reportEntity.mock.calls[0][0]).toEqual({
      target: { context: 'product', id: 'p1' },
      reason: 'fraud',
      details: '',
    });
    expect(show.mock.calls[0][0]).toMatchObject({
      type: 'success',
      text1: 'product:report.product.sentTitle',
      text2: 'product:report.product.sentMsg',
    });
    expect(all(view, 'ConfirmDialog')).toHaveLength(0);
    await view.unmount();
  });

  test('a failed report shows the error and keeps the picker open to retry', async () => {
    show.mockClear();
    reportEntity.mockClear();
    outcome = 'error';
    const view = await render(
      <OptionsMenu targetId="p1" sellerId="s1" context="product" />,
    );
    await openReport(view, 'product:report.product.action');
    await press(pressableWithText(view, 'product:report.reasons.spam'));
    await act(async () => (dialog(view).props.onConfirm as () => unknown)());

    expect(show.mock.calls[0][0]).toMatchObject({
      type: 'error',
      text1: 'product:report.errorTitle',
      text2: 'product:report.errorMsg',
    });
    expect(dialog(view).props.disabled).toBe(false);
    await view.unmount();
  });
}
