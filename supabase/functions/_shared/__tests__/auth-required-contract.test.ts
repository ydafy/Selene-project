import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FUNCTIONS_DIR = join(import.meta.dir, '..', '..');

// A valid token that is not a signed-in user (the anon key) must get the stable code, not Spanish text.
const FUNCTIONS = [
  'cancel-order',
  'create-dispute',
  'create-return-intent',
  'generate-return-label',
  'generate-shipping-label',
  'resolve-dispute',
  'resolve-dispute-refund',
];

describe('AUTH_REQUIRED contract', () => {
  for (const name of FUNCTIONS) {
    it(`${name} answers 401 AUTH_REQUIRED when getUser finds no user`, () => {
      const source = readFileSync(join(FUNCTIONS_DIR, name, 'index.ts'), 'utf8');
      expect(source).not.toContain('No autorizado');
      expect(source).toMatch(
        /if \(authError \|\| !user\)\s*(throw new ApiError\(401, 'AUTH_REQUIRED'\)|return new Response\(JSON\.stringify\(\{ error: 'AUTH_REQUIRED' \}\),\s*\{\s*status: 401,)/,
      );
    });
  }
});
