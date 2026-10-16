import { expect, test } from '@playwright/test';

test('opens the local admin login', async ({ page }) => {
  const response = await page.goto('/login');

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL('/login');
  await expect(
    page.getByRole('heading', { name: 'SELENE', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Entrar al Sistema', exact: true }),
  ).toBeEnabled();
});
