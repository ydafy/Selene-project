import { expect, test } from '@playwright/test';

// Use the real login UI, but never send requests outside this worktree's server.
test('opens the local admin login without external traffic', async ({ page, context, baseURL }) => {
  await context.route('**/*', (route) => {
    const request = route.request();
    return new URL(request.url()).origin === baseURL && request.method() === 'GET'
      ? route.continue()
      : route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
  const response = await page.goto('/login');

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', { name: 'SELENE', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar al Sistema', exact: true })).toBeEnabled();
});
