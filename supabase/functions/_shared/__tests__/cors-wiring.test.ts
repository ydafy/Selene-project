// source-text: the CORS policy is a wiring contract; every function's entry point and the
// admin-web sources that call it are the text under test.
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const FUNCTIONS_DIR = join(import.meta.dir, '..', '..');
const ADMIN_WEB_SRC = join(
  FUNCTIONS_DIR,
  '..',
  '..',
  'apps',
  'admin-web',
  'src',
);
const CORS_MODULE = join(FUNCTIONS_DIR, '_shared', 'cors.ts');

const compact = (source: string) =>
  source
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .replace(/,\)/g, ')');

const isTest = (path: string) => /\.test\.tsx?$/.test(path);

function sourceFiles(dir: string, extensions: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && extensions.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !isTest(path));
}

const FUNCTIONS = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => entry.name)
  .sort();

// A function the admin-web calls from the browser: its folder name appears as a string literal
// in the admin-web sources (`supabase.functions.invoke('<name>')`, `invokeEdge('<name>')`).
const adminWebSource = sourceFiles(ADMIN_WEB_SRC, /\.tsx?$/)
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');
const ADMIN_WEB_FUNCTIONS = FUNCTIONS.filter((name) =>
  new RegExp(`['"\`]${name}['"\`]`).test(adminWebSource),
);

const indexSource = (name: string) =>
  readFileSync(join(FUNCTIONS_DIR, name, 'index.ts'), 'utf8');

describe('CORS wiring', () => {
  it('finds the functions the admin-web calls', () => {
    expect(ADMIN_WEB_FUNCTIONS).toContain('release-connect-payout');
    expect(ADMIN_WEB_FUNCTIONS).toContain('list-shipment-refund-problems');
    expect(ADMIN_WEB_FUNCTIONS).not.toContain('stripe-webhooks');
  });

  it('sets CORS headers only in the shared module', () => {
    const offenders = sourceFiles(FUNCTIONS_DIR, /\.ts$/)
      .filter((path) => path !== CORS_MODULE)
      .filter((path) => /access-control-/i.test(readFileSync(path, 'utf8')))
      .map((path) => relative(FUNCTIONS_DIR, path).replaceAll('\\', '/'));
    expect(offenders).toEqual([]);
  });

  for (const name of FUNCTIONS) {
    const calledByAdminWeb = ADMIN_WEB_FUNCTIONS.includes(name);

    it(`${name} ${calledByAdminWeb ? 'answers' : 'never answers'} admin-web origins`, () => {
      const source = indexSource(name);
      const servedWithCors = compact(source).includes(
        `serveAdminWeb(withSentry('${name}', `,
      );
      const imported =
        /import \{[^}]*serveAdminWeb[^}]*\} from '\.\.\/_shared\/cors\.ts';/.test(
          source,
        );

      expect({ servedWithCors, imported }).toEqual({
        servedWithCors: calledByAdminWeb,
        imported: calledByAdminWeb,
      });
    });
  }
});
