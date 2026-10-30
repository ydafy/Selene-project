import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

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

  it('is the schema the worker checks the evidence RPC result with', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain('from "./charge-evidence-schema.ts"');
    expect(source).toContain('RecoveryChargeEvidenceSchema.safeParse(data)');
  });
});
