import { describe, expect, it } from 'bun:test';

import { SELENE_DOMAIN, SELENE_WEB_URL } from '../index.ts';

describe('Selene domain', () => {
  it('uses the reserved placeholder until the real domain exists', () => {
    // `.example` is reserved (RFC 2606) and never resolves, so no mail or link
    // can reach a third party by mistake. Replace it in `domain.ts` only.
    expect(SELENE_DOMAIN).toBe('selene.example');
  });

  it('derives the public web URL from the single domain constant', () => {
    expect(SELENE_WEB_URL).toBe(`https://${SELENE_DOMAIN}`);
  });
});
