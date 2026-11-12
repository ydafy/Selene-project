import { describe, expect, it } from 'bun:test';

import { createConnectOnboardingReturnHandler } from './handler.ts';

const BRIDGE =
  'https://project.supabase.co/functions/v1/connect-onboarding-return';

function harness(env: Record<string, string> = {}) {
  const read: string[] = [];
  const handler = createConnectOnboardingReturnHandler({
    getEnv: (name) => {
      read.push(name);
      return env[name];
    },
  });
  return { handler, read };
}

const expectJson = async (
  response: Response,
  status: number,
  body: unknown,
) => {
  expect(response.status).toBe(status);
  expect(response.headers.get('Content-Type')).toBe('application/json');
  expect(await response.json()).toEqual(body);
};

const expectRedirect = async (response: Response, location: string) => {
  expect(response.status).toBe(302);
  expect(response.headers.get('Location')).toBe(location);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.text()).toBe('');
};

describe('connect-onboarding-return handler', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    it(`answers 405 METHOD_NOT_ALLOWED to ${method} without reading configuration`, async () => {
      const { handler, read } = harness();

      await expectJson(
        await handler(new Request(`${BRIDGE}?state=return`, { method })),
        405,
        { error: 'METHOD_NOT_ALLOWED' },
      );
      expect(read).toEqual([]);
    });
  }

  it('redirects a return to the default app deep link', async () => {
    const { handler, read } = harness();

    await expectRedirect(
      await handler(new Request(`${BRIDGE}?state=return`)),
      'selene://sell/onboarding?return=1',
    );
    expect(read.sort()).toEqual([
      'SELENE_CONNECT_ONBOARDING_APP_URL',
      'SELENE_CONNECT_ONBOARDING_REFRESH_DEEP_LINK',
      'SELENE_CONNECT_ONBOARDING_RETURN_DEEP_LINK',
    ]);
  });

  it('redirects a refresh to the configured app URL', async () => {
    const { handler } = harness({
      SELENE_CONNECT_ONBOARDING_APP_URL:
        'https://selene.example/sell/onboarding',
    });

    await expectRedirect(
      await handler(new Request(`${BRIDGE}?state=refresh`)),
      'https://selene.example/sell/onboarding?refresh=1',
    );
  });

  it('redirects to the configured per-state deep links', async () => {
    const { handler } = harness({
      SELENE_CONNECT_ONBOARDING_RETURN_DEEP_LINK:
        'exp://127.0.0.1:8081/--/return',
      SELENE_CONNECT_ONBOARDING_REFRESH_DEEP_LINK:
        'exp://127.0.0.1:8081/--/refresh',
    });

    await expectRedirect(
      await handler(new Request(`${BRIDGE}?state=return`)),
      'exp://127.0.0.1:8081/--/return',
    );
    await expectRedirect(
      await handler(new Request(`${BRIDGE}?state=refresh`)),
      'exp://127.0.0.1:8081/--/refresh',
    );
  });

  it('answers 400 INVALID_ONBOARDING_RETURN_STATE for an unknown state', async () => {
    const { handler } = harness();

    await expectJson(await handler(new Request(`${BRIDGE}?state=steal`)), 400, {
      error: 'INVALID_ONBOARDING_RETURN_STATE',
    });
  });

  it('answers 500 INVALID_ONBOARDING_APP_URL for a malformed configured URL', async () => {
    const { handler } = harness({
      SELENE_CONNECT_ONBOARDING_APP_URL: 'not a url',
    });

    await expectJson(
      await handler(new Request(`${BRIDGE}?state=return`)),
      500,
      { error: 'INVALID_ONBOARDING_APP_URL' },
    );
  });
});
