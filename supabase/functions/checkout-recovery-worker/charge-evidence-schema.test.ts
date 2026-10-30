import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { RecoveryChargeEvidenceSchema } from './charge-evidence-schema.ts';

// Prettier may re-wrap the source files read below and rewrite double quotes
// to single quotes; compare without layout or quote style.
const compact = (source: string) =>
  source
    .replace(/\s+/g, ' ')
    .replace(/([([{]) /g, '$1')
    .replace(/ ([)\]}])/g, '$1')
    .replace(/,([)\]}])/g, '$1')
    .replace(/ \./g, '.')
    .replace(/"/g, "'");

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
    const source = compact(
      readFileSync(new URL('./index.ts', import.meta.url), 'utf8'),
    );

    expect(source).toContain(compact('from "./charge-evidence-schema.ts"'));
    expect(source).toContain(
      compact('RecoveryChargeEvidenceSchema.safeParse(data)'),
    );
  });
});
