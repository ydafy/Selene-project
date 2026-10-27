import { describe, expect, it } from 'bun:test';

import {
  ACCOUNT_DELETION_PATH,
  ACCOUNT_DELETION_URL,
  PRIVACY_PATH,
  PRIVACY_URL,
  SELENE_DOMAIN,
  SELENE_SUPPORT_EMAIL,
  SELENE_WEB_URL,
} from '../index.ts';

describe('Selene domain', () => {
  it('uses the reserved placeholder until the real domain exists', () => {
    // `.example` is reserved (RFC 2606) and never resolves, so no mail or link
    // can reach a third party by mistake. Replace it in `domain.ts` only.
    expect(SELENE_DOMAIN).toBe('selene.example');
  });

  it('derives the public web URL from the single domain constant', () => {
    expect(SELENE_WEB_URL).toBe(`https://${SELENE_DOMAIN}`);
  });

  it('derives the support address from the single domain constant', () => {
    expect(SELENE_SUPPORT_EMAIL).toBe(`soporte@${SELENE_DOMAIN}`);
  });

  it('keeps the public page paths and derives their URLs from the web URL', () => {
    expect(ACCOUNT_DELETION_PATH).toBe('/eliminar-cuenta');
    expect(PRIVACY_PATH).toBe('/privacidad');
    expect(ACCOUNT_DELETION_URL).toBe(`${SELENE_WEB_URL}/eliminar-cuenta`);
    expect(PRIVACY_URL).toBe(`${SELENE_WEB_URL}/privacidad`);
  });
});
