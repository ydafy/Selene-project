import { expect, mock, test } from 'bun:test';
import React from 'react';

// T8i (odd/tasks/auth-hardening.md, L98 and L101 review advisories): the mounted hCaptcha
// provider, driven through the real registry the auth calls use. Module mocks stay in a child
// process so they cannot leak into other test files.
if (process.env.SELENE_CAPTCHA_CHILD !== '1') {
  test('CaptchaProvider answers the auth calls through the mounted widget (isolated)', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_CAPTCHA_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (child.exitCode !== 0)
      throw new Error(new TextDecoder().decode(child.stderr));
    expect(child.exitCode).toBe(0);
  });
} else {
  process.env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY =
    '10000000-ffff-ffff-ffff-000000000001';

  type WidgetProps = {
    siteKey: string;
    size: string;
    languageCode: string;
    onMessage: (event: {
      success?: boolean;
      nativeEvent?: { data?: string };
      markUsed?: () => void;
    }) => void;
  };
  const show = mock(() => {});
  const hide = mock(() => {});
  let widgetProps: WidgetProps | null = null;

  class FakeHcaptcha extends React.Component<WidgetProps> {
    show = show;
    hide = hide;
    render() {
      widgetProps = this.props;
      return null;
    }
  }

  mock.module('react-native', () => ({
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
  }));
  mock.module('@hcaptcha/react-native-hcaptcha', () => ({
    default: FakeHcaptcha,
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({ i18n: { language: 'es' } }),
  }));

  // The pure entry skips the automatic cleanup after each test: one provider stays
  // mounted for the whole file, as at the app root, and the last test unmounts it.
  const { act, render } = await import('@testing-library/react-native/pure');
  const { CaptchaProvider } = await import('./captcha-provider');
  const { getCaptchaToken } = await import('@/shared/lib/auth/captcha');

  const message = async (data: string, success = false) => {
    const markUsed = mock(() => {});
    await act(() =>
      widgetProps!.onMessage({ success, nativeEvent: { data }, markUsed }),
    );
    return markUsed;
  };
  const codeOf = async (promise: Promise<unknown>) =>
    promise.then(
      () => 'resolved',
      (error: { code?: string }) => error.code,
    );
  const reset = () => {
    show.mockClear();
    hide.mockClear();
  };

  const root = await render(<CaptchaProvider />);

  test('mounts one invisible widget with the site key and the app language', () => {
    expect(widgetProps?.siteKey).toBe('10000000-ffff-ffff-ffff-000000000001');
    expect(widgetProps?.size).toBe('invisible');
    expect(widgetProps?.languageCode).toBe('es');
  });

  test('a solved challenge resolves the token, marks it used and closes the widget', async () => {
    reset();
    const token = getCaptchaToken();
    await Promise.resolve();
    expect(show).toHaveBeenCalledTimes(1);
    const markUsed = await message('token-123', true);
    expect(await token).toBe('token-123');
    expect(markUsed).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  test('the open event keeps waiting; a cancel rejects with captcha_cancelled', async () => {
    reset();
    // Observe the rejection before the awaited act can flush it as unhandled.
    const code = codeOf(getCaptchaToken());
    await Promise.resolve();
    await message('open');
    expect(hide).not.toHaveBeenCalled();
    await message('challenge-closed');
    expect(await code).toBe('captcha_cancelled');
    expect(hide).toHaveBeenCalledTimes(1);
  });

  test('an SDK error rejects with captcha_failed', async () => {
    reset();
    const code = codeOf(getCaptchaToken());
    await Promise.resolve();
    await message('network-error');
    expect(await code).toBe('captcha_failed');
  });

  test('a new request cancels the pending one; a late event changes nothing', async () => {
    reset();
    const first = getCaptchaToken();
    await Promise.resolve();
    const second = getCaptchaToken();
    await Promise.resolve();
    expect(await codeOf(first)).toBe('captcha_cancelled');
    await message('token-2', true);
    expect(await second).toBe('token-2');
    hide.mockClear();
    await message('expired');
    expect(hide).not.toHaveBeenCalled();
  });

  test('after unmount the auth calls fail closed', async () => {
    await root.unmount();
    expect(await codeOf(getCaptchaToken())).toBe('captcha_failed');
  });
}
