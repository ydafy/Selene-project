import { expect, test } from '@playwright/test';

import {
  ACCOUNT_DELETION_PATH,
  PRIVACY_PATH,
  SELENE_SUPPORT_EMAIL,
  TERMS_PATH,
} from '../../packages/types/src/domain';

// Public pages must render without a session and never bounce to /login.
test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) => {
    const request = route.request();
    return new URL(request.url()).origin === baseURL &&
      request.method() === 'GET'
      ? route.continue()
      : route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
});

test('shows the account deletion page without a session', async ({ page }) => {
  const response = await page.goto(ACCOUNT_DELETION_PATH);

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(ACCOUNT_DELETION_PATH);
  await expect(
    page.getByRole('heading', { name: 'Eliminar tu cuenta de Selene' }),
  ).toBeVisible();
  await expect(
    page.getByText('Perfil > Ajustes > Privacidad > Eliminar cuenta'),
  ).toBeVisible();
  await expect(
    page.getByText('5 años', { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: SELENE_SUPPORT_EMAIL }),
  ).toHaveAttribute('href', `mailto:${SELENE_SUPPORT_EMAIL}`);
});

test('shows the privacy summary with the pending legal review notice', async ({
  page,
}) => {
  const response = await page.goto(PRIVACY_PATH);

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(PRIVACY_PATH);
  await expect(
    page.getByRole('heading', { name: 'Privacidad en Selene' }),
  ).toBeVisible();
  await expect(page.getByRole('note')).toContainText(
    'pendiente de revisión legal',
  );
  await expect(
    page.getByRole('link', { name: SELENE_SUPPORT_EMAIL }),
  ).toBeVisible();
});

test('shows the terms summary with the pending legal review notice', async ({
  page,
}) => {
  const response = await page.goto(TERMS_PATH);

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(TERMS_PATH);
  await expect(
    page.getByRole('heading', { name: 'Términos y condiciones de Selene' }),
  ).toBeVisible();
  await expect(page.getByRole('note')).toContainText(
    'pendientes de revisión legal',
  );
  await expect(
    page.getByRole('heading', { name: 'Seguro Selene' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Eliminar cuenta' }),
  ).toHaveAttribute('href', ACCOUNT_DELETION_PATH);
  await expect(page.getByRole('link', { name: 'Privacidad' })).toHaveAttribute(
    'href',
    PRIVACY_PATH,
  );
  await expect(
    page.getByRole('link', { name: SELENE_SUPPORT_EMAIL }),
  ).toBeVisible();
});
