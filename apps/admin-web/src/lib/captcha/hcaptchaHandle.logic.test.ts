import { describe, expect, mock, test } from 'bun:test';

import { createCaptchaGetter } from './captcha.logic';
import { createHcaptchaHandle, type HcaptchaWidgetLike } from './hcaptchaHandle.logic';

// T8i (odd/tasks/auth-hardening.md, L99 and L101): the admin login's hCaptcha handle, driven
// through the same getter the login uses, with a fake widget in place of the SDK component.
const widgetThat = (execute: HcaptchaWidgetLike['execute']) => ({
  execute: mock(execute),
  resetCaptcha: mock(() => {}),
});

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error: { code?: string }) => error.code,
  );

describe('createHcaptchaHandle', () => {
  test('returns the token and resets the widget so the next login gets a fresh challenge', async () => {
    const widget = widgetThat(async () => ({ response: 'token-1' }));
    const getToken = createCaptchaGetter(() => createHcaptchaHandle(() => widget, true));

    expect(await getToken()).toBe('token-1');
    expect(widget.execute).toHaveBeenCalledWith({ async: true });
    expect(widget.resetCaptcha).toHaveBeenCalledTimes(1);
  });

  test('a closed challenge is captcha_cancelled and still resets the widget', async () => {
    const widget = widgetThat(() => Promise.reject('challenge-closed'));
    const getToken = createCaptchaGetter(() => createHcaptchaHandle(() => widget, true));

    expect(await codeOf(getToken())).toBe('captcha_cancelled');
    expect(widget.resetCaptcha).toHaveBeenCalledTimes(1);
  });

  test('any other widget error is captcha_failed', async () => {
    const widget = widgetThat(() => Promise.reject('network-error'));
    const getToken = createCaptchaGetter(() => createHcaptchaHandle(() => widget, true));

    expect(await codeOf(getToken())).toBe('captcha_failed');
  });

  test('a configured key without a mounted widget is captcha_cancelled', async () => {
    const getToken = createCaptchaGetter(() => createHcaptchaHandle(() => null, true));
    expect(await codeOf(getToken())).toBe('captcha_cancelled');
  });

  test('without a site key the login sends no token and never touches the widget', async () => {
    const widget = widgetThat(async () => ({ response: 'unused' }));
    const getToken = createCaptchaGetter(() => createHcaptchaHandle(() => widget, false));

    expect(await getToken()).toBeUndefined();
    expect(widget.execute).not.toHaveBeenCalled();
  });

  test('a timed-out challenge is captcha_failed and the open widget is reset', async () => {
    const widget = widgetThat(() => new Promise<never>(() => {}));
    const getToken = createCaptchaGetter(() => createHcaptchaHandle(() => widget, true), 5);

    expect(await codeOf(getToken())).toBe('captcha_failed');
    expect(widget.resetCaptcha).toHaveBeenCalledTimes(1);
  });
});
