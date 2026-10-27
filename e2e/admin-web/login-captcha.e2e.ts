import { expect, test } from '@playwright/test';

// The e2e server sets no VITE_HCAPTCHA_SITE_KEY: the login must behave as before CAPTCHA.
test('renders no captcha widget and submits the login without a token', async ({ page, context, baseURL }) => {
  const tokenBodies: string[] = [];
  const blocked: string[] = [];
  await context.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/auth/v1/token' && request.method() === 'POST') {
      tokenBodies.push(request.postData() ?? '');
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' }),
      });
    }
    if (url.origin === baseURL && request.method() === 'GET') return route.continue();
    blocked.push(request.url());
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto('/login');

  await expect(page.locator('iframe[src*="hcaptcha"]')).toHaveCount(0);
  await page.getByPlaceholder('admin@selene.mx').fill('admin@selene.local');
  await page.getByPlaceholder('••••••••').fill('password123');
  await page.getByRole('button', { name: 'Entrar al Sistema', exact: true }).click();

  await expect(page.getByText('Invalid login credentials')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar al Sistema', exact: true })).toBeEnabled();
  expect(tokenBodies).toHaveLength(1);
  expect(JSON.parse(tokenBodies[0]).gotrue_meta_security?.captcha_token).toBeUndefined();
  expect(blocked.filter((url) => url.includes('hcaptcha'))).toEqual([]);
});
