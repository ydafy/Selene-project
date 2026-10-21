import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FUNCTIONS = [
  'stripe-webhooks',
  'create-connect-payment',
  'rollback-connect-payment',
  'cancel-order',
  'auto-cancel-orders',
  'auto-cancel-preparing',
];

describe('Sentry wiring', () => {
  for (const name of FUNCTIONS) {
    describe(name, () => {
      const source = readFileSync(join(import.meta.dir, '..', '..', name, 'index.ts'), 'utf8');

      it('imports withSentry from the shared helper', () => {
        expect(source).toMatch(
          /import \{[^}]*withSentry[^}]*\} from '\.\.\/_shared\/sentry\.ts';/,
        );
      });

      it('wraps the serve handler with its own folder name', () => {
        expect(source).toContain(`serve(withSentry('${name}', `);
        expect(source.match(/\bserve\(/g)).toHaveLength(1);
      });
    });
  }
});
