import { describe, expect, it } from 'bun:test';

import { RecoveryChargeEvidenceSchema } from './charge-evidence-schema.ts';

describe('checkout recovery charge evidence schema', () => {
  it('accepts the charge id the evidence RPC persisted', () => {
    expect(RecoveryChargeEvidenceSchema.parse('ch_3Pq')).toBe('ch_3Pq');
  });

  it('rejects an empty, missing, or non-string RPC result', () => {
    for (const invalid of ['', null, undefined, 42, { charge: 'ch_3Pq' }]) {
      expect(RecoveryChargeEvidenceSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });
});
