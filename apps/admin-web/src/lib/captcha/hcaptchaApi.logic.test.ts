import { describe, expect, mock, test } from 'bun:test';

import {
  HCAPTCHA_ONLOAD_CALLBACK,
  createHcaptchaLoader,
  createHcaptchaWidget,
  hcaptchaScriptUrl,
} from './hcaptchaApi.logic';

const fakeApi = () => ({
  render: mock<HcaptchaApi['render']>(() => 'id-1'),
  execute: mock<HcaptchaApi['execute']>(async () => ({ response: 'tok' })),
  reset: mock<HcaptchaApi['reset']>(() => {}),
  remove: mock<HcaptchaApi['remove']>(() => {}),
});
const container = {} as HTMLElement;

describe('createHcaptchaLoader', () => {
  test('appends the explicit-render script once and resolves on the onload callback', async () => {
    const win: Record<string, unknown> = {};
    const appendScript = mock<(src: string, onError: () => void) => void>(
      () => {},
    );
    const load = createHcaptchaLoader(win, appendScript);

    const first = load();
    const second = load();
    expect(appendScript).toHaveBeenCalledTimes(1);
    expect(appendScript.mock.calls[0]?.[0]).toBe(hcaptchaScriptUrl());
    expect(hcaptchaScriptUrl()).toBe(
      'https://js.hcaptcha.com/1/api.js?render=explicit&onload=onHcaptchaApiLoaded&hl=es',
    );

    const api = fakeApi();
    win.hcaptcha = api;
    (win[HCAPTCHA_ONLOAD_CALLBACK] as () => void)();
    expect(await first).toBe(api);
    expect(await second).toBe(api);
  });

  test('reuses an existing window.hcaptcha without a script', async () => {
    const api = fakeApi();
    const appendScript = mock(() => {});
    expect(await createHcaptchaLoader({ hcaptcha: api }, appendScript)()).toBe(
      api,
    );
    expect(appendScript).not.toHaveBeenCalled();
  });

  test('a failed script load rejects and the next call retries', async () => {
    const appendScript = mock((_src: string, onError: () => void) => onError());
    const load = createHcaptchaLoader({}, appendScript);

    await expect(load()).rejects.toThrow('hcaptcha_script_failed');
    await expect(load()).rejects.toThrow('hcaptcha_script_failed');
    expect(appendScript).toHaveBeenCalledTimes(2);
  });
});

describe('createHcaptchaWidget', () => {
  test('a request before the API is ready waits, then renders invisibly and executes', async () => {
    const api = fakeApi();
    let release!: (value: ReturnType<typeof fakeApi>) => void;
    const widget = createHcaptchaWidget(
      () => new Promise((resolve) => (release = resolve)),
      container,
      'site-key',
    );

    const result = widget.execute({ async: true });
    expect(api.render).not.toHaveBeenCalled();
    release(api);

    expect(await result).toEqual({ response: 'tok' });
    expect(api.render).toHaveBeenCalledWith(container, {
      sitekey: 'site-key',
      size: 'invisible',
    });
    expect(api.execute).toHaveBeenCalledWith('id-1', { async: true });
  });

  test('renders once across requests and resets by widget id', async () => {
    const api = fakeApi();
    const widget = createHcaptchaWidget(async () => api, container, 'k');
    await widget.execute({ async: true });
    await widget.execute({ async: true });
    widget.resetCaptcha();

    expect(api.render).toHaveBeenCalledTimes(1);
    expect(api.reset).toHaveBeenCalledWith('id-1');
  });

  test('reset before the API is ready is a no-op', () => {
    const widget = createHcaptchaWidget(
      () => new Promise(() => {}),
      container,
      'k',
    );
    expect(() => widget.resetCaptcha()).not.toThrow();
  });

  test('dispose removes the rendered widget once and cancels later requests', async () => {
    const api = fakeApi();
    const widget = createHcaptchaWidget(async () => api, container, 'k');
    await widget.execute({ async: true });

    widget.dispose();
    widget.dispose();
    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(api.remove).toHaveBeenCalledWith('id-1');
    await expect(widget.execute({ async: true })).rejects.toMatchObject({
      code: 'captcha_cancelled',
    });
  });

  test('dispose before the API loads never renders (StrictMode first mount)', async () => {
    const api = fakeApi();
    let release!: (value: ReturnType<typeof fakeApi>) => void;
    const widget = createHcaptchaWidget(
      () => new Promise((resolve) => (release = resolve)),
      container,
      'k',
    );
    const result = widget.execute({ async: true });
    widget.dispose();
    release(api);

    await expect(result).rejects.toMatchObject({ code: 'captcha_cancelled' });
    expect(api.render).not.toHaveBeenCalled();
  });

  test('dispose swallows a remove that throws a plain object', async () => {
    const api = fakeApi();
    api.remove = mock(() => {
      throw { cause: 'missing-captcha' };
    });
    const widget = createHcaptchaWidget(async () => api, container, 'k');
    await widget.execute({ async: true });
    expect(() => widget.dispose()).not.toThrow();
  });
});
