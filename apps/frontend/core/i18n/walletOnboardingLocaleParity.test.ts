import { describe, expect, it } from 'bun:test';

import enWallet from './locales/en/wallet.json';
import esWallet from './locales/es/wallet.json';

const REQUIRED_STATUS_GUIDANCE_KEYS = [
  'newTitle',
  'newDesc',
  'pendingTitle',
  'pendingDesc',
  'rejectedTitle',
  'rejectedDesc',
] as const;

describe('wallet onboarding locale parity', () => {
  it('keeps final-step status guidance keys in English and Spanish', () => {
    for (const key of REQUIRED_STATUS_GUIDANCE_KEYS) {
      expect(enWallet.onboarding.statusGuidance[key]).toBeString();
      expect(esWallet.onboarding.statusGuidance[key]).toBeString();
    }

    expect(Object.keys(enWallet.onboarding.statusGuidance).sort()).toEqual(
      Object.keys(esWallet.onboarding.statusGuidance).sort(),
    );
  });
});
