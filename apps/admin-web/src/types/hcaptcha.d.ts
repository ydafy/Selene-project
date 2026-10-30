/** The slice of the hCaptcha explicit-render API that `lib/captcha` uses. */
interface HcaptchaApi {
  render: (
    container: HTMLElement,
    options: { sitekey: string; size: 'invisible' },
  ) => string;
  execute: (
    widgetId: string,
    options: { async: true },
  ) => Promise<{ response: string }>;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

interface Window {
  hcaptcha?: HcaptchaApi;
}
