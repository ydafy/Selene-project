import { describe, expect, it } from 'bun:test';
import { corsHeaders as supabaseCorsHeaders } from '@supabase/supabase-js/cors';

import { createAdminWebCors, parseAllowedOrigins } from './cors';

const ADMIN = 'https://admin.selene.example';
const LOCAL = 'http://127.0.0.1:5188';
const ORIGINS = `${ADMIN}, ${LOCAL}`;

const HANDLER_BODY = JSON.stringify({ ok: true });

function setup(origins: string | undefined) {
  const calls: Request[] = [];
  const handler = (req: Request) => {
    calls.push(req);
    return new Response(HANDLER_BODY, {
      status: 201,
      statusText: 'Created',
      headers: { 'Content-Type': 'application/json', 'X-Handler': 'yes' },
    });
  };
  const wrapped = createAdminWebCors(() => origins)(handler);
  return { calls, wrapped };
}

const request = (method: string, origin?: string) =>
  new Request('http://localhost/functions/v1/example', {
    method,
    headers: origin ? { Origin: origin } : {},
  });

const corsHeaderNames = (response: Response) =>
  [...response.headers.keys()].filter((name) =>
    name.startsWith('access-control-'),
  );

describe('parseAllowedOrigins', () => {
  it('keeps exact origins and trims the comma-separated list', () => {
    expect([...parseAllowedOrigins(` ${ADMIN} ,${LOCAL},, `)]).toEqual([
      ADMIN,
      LOCAL,
    ]);
  });

  it('drops entries that are not an exact origin', () => {
    expect([
      ...parseAllowedOrigins(
        '*,null,localhost:5173,http://localhost:5173/,http://localhost:5173/admin,HTTP://Localhost:5173',
      ),
    ]).toEqual([]);
  });

  it('is empty when the variable is missing or blank', () => {
    expect(parseAllowedOrigins(undefined).size).toBe(0);
    expect(parseAllowedOrigins('  ').size).toBe(0);
  });
});

describe('createAdminWebCors', () => {
  it('answers a preflight from an allowed origin without calling the handler', async () => {
    const { calls, wrapped } = setup(ORIGINS);

    const response = await wrapped(request('OPTIONS', LOCAL));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(LOCAL);
    // Every header the pinned supabase-js client may send, as its own `cors` export lists them.
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      supabaseCorsHeaders['Access-Control-Allow-Headers'],
    );
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, POST, OPTIONS',
    );
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(calls).toHaveLength(0);
  });

  it('answers a preflight from another origin without CORS headers', async () => {
    const { calls, wrapped } = setup(ORIGINS);

    const response = await wrapped(request('OPTIONS', 'https://evil.example'));

    expect(response.status).toBe(204);
    expect(corsHeaderNames(response)).toEqual([]);
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(calls).toHaveLength(0);
  });

  it('answers a preflight without an Origin header without CORS headers', async () => {
    const { calls, wrapped } = setup(ORIGINS);

    const response = await wrapped(request('OPTIONS'));

    expect(response.status).toBe(204);
    expect(corsHeaderNames(response)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('adds the allowed origin to the handler response and keeps the rest', async () => {
    const { calls, wrapped } = setup(ORIGINS);

    const response = await wrapped(request('POST', ADMIN));

    expect(calls).toHaveLength(1);
    expect(response.status).toBe(201);
    expect(response.statusText).toBe('Created');
    expect(await response.text()).toBe(HANDLER_BODY);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('X-Handler')).toBe('yes');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ADMIN);
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('serves a request from another origin without CORS headers', async () => {
    const { calls, wrapped } = setup(ORIGINS);

    const response = await wrapped(request('GET', 'http://localhost:8081'));

    expect(calls).toHaveLength(1);
    expect(response.status).toBe(201);
    expect(await response.text()).toBe(HANDLER_BODY);
    expect(corsHeaderNames(response)).toEqual([]);
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('matches origins exactly', async () => {
    const { wrapped } = setup(ORIGINS);

    for (const origin of [
      'http://127.0.0.1:51880',
      'https://127.0.0.1:5188',
      'http://localhost:5188',
      'https://admin.selene.example.evil.example',
    ]) {
      const response = await wrapped(request('OPTIONS', origin));
      expect(corsHeaderNames(response)).toEqual([]);
    }
  });

  it('fails closed when no origin is configured', async () => {
    for (const origins of [undefined, '', '*']) {
      const { wrapped } = setup(origins);

      const preflight = await wrapped(request('OPTIONS', ADMIN));
      const response = await wrapped(request('POST', ADMIN));

      expect(corsHeaderNames(preflight)).toEqual([]);
      expect(corsHeaderNames(response)).toEqual([]);
      expect(response.status).toBe(201);
    }
  });

  it('never allows the null origin, even when it is listed', async () => {
    const { wrapped } = setup(`null, ${ADMIN}`);

    const response = await wrapped(request('OPTIONS', 'null'));

    expect(corsHeaderNames(response)).toEqual([]);
  });

  it('never allows credentials', async () => {
    const { wrapped } = setup(ORIGINS);

    for (const method of ['OPTIONS', 'POST']) {
      const response = await wrapped(request(method, ADMIN));
      expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(
        false,
      );
    }
  });

  it('lets a handler error propagate, so Sentry still sees it', async () => {
    const wrapped = createAdminWebCors(() => ORIGINS)(() => {
      throw new Error('boom');
    });

    await expect(wrapped(request('POST', ADMIN))).rejects.toThrow('boom');
  });

  it('keeps the handler Vary header and appends Origin', async () => {
    const wrapped = createAdminWebCors(() => ORIGINS)(
      () => new Response('x', { headers: { Vary: 'Accept' } }),
    );

    const response = await wrapped(request('POST', ADMIN));

    expect(response.headers.get('Vary')).toBe('Accept, Origin');
  });
});
