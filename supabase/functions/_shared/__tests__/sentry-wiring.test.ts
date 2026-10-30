import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FUNCTIONS_DIR = join(import.meta.dir, '..', '..');

// Prettier may wrap `serve(withSentry(...))` over several lines; compare without line breaks.
const compact = (source: string) =>
  source
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .replace(/,\)/g, ')');

// Every function folder: `_shared`, `__tests__` and other underscore folders are not functions.
const FUNCTIONS = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => entry.name)
  .sort();

describe('Sentry wiring', () => {
  it('finds the function folders', () => {
    expect(FUNCTIONS).toContain('stripe-webhooks');
    expect(FUNCTIONS).toContain('release-connect-payout');
    expect(FUNCTIONS.length).toBeGreaterThan(30);
  });

  for (const name of FUNCTIONS) {
    describe(name, () => {
      const indexPath = join(FUNCTIONS_DIR, name, 'index.ts');

      it('has an index.ts entry point', () => {
        expect(existsSync(indexPath)).toBe(true);
      });

      const source = existsSync(indexPath)
        ? readFileSync(indexPath, 'utf8')
        : '';

      it('imports withSentry from the shared helper', () => {
        expect(source).toMatch(
          /import \{[^}]*withSentry[^}]*\} from '\.\.\/_shared\/sentry\.ts';/,
        );
      });

      it('wraps the serve handler with its own folder name', () => {
        expect(compact(source)).toContain(`serve(withSentry('${name}', `);
        expect(source.match(/\bserve\(/g)).toHaveLength(1);
      });
    });
  }
});
