// Guard for Edge Function `npm:` specifiers. Deno resolves them from the root
// `node_modules`, so each `npm:<name>@<version>` must equal an exact devDependency
// pin in the root package.json. Checked by edge-function-npm-pins.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type NpmPinFile = { path: string; text: string };

const EXACT_VERSION =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
// A specifier opens right after a quote, like an import or a config value.
// Prose such as "cannot resolve npm:zod" is not one.
const SPECIFIER =
  /(['"`])npm:((?:@[\w.~-]+\/)?[\w.~-]+)(?:@([\w.+-]+))?(\/[^'"`\s]*)?/g;

export function readRootDevDependencies(root: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return manifest.devDependencies ?? {};
}

// The files whose `npm:` specifiers Deno or the Bun test preload resolve: Edge
// Function sources, their Deno config, and the root bunfig.toml.
export function collectNpmPinFiles(
  repoFiles: string[],
  read: (file: string) => string,
): NpmPinFile[] {
  return repoFiles
    .filter(
      (file) =>
        file === 'bunfig.toml' ||
        (file.startsWith('supabase/functions/') &&
          /\.(?:tsx?|jsonc?)$/.test(file) &&
          (!/\.jsonc?$/.test(file) || /(?:^|\/)deno\.jsonc?$/.test(file))),
    )
    .map((path) => ({ path, text: read(path) }));
}

const isComment = (line: string) => /^\s*(?:\/\/|\/\*|\*|#)/.test(line);

export function findNpmPinProblems(
  files: NpmPinFile[],
  devDependencies: Record<string, string>,
): string[] {
  const problems: string[] = [];
  const rangePins = new Set<string>();
  for (const { path, text } of files) {
    for (const line of text.split('\n')) {
      if (isComment(line)) continue;
      for (const match of line.matchAll(SPECIFIER)) {
        const [whole, , name, version, subpath = ''] = match;
        const specifier = whole.slice(1);
        const pin = devDependencies[name];
        if (pin === undefined) {
          problems.push(
            `${path}: "${specifier}" is not an exact devDependency in the root package.json; add "${name}": "${version ?? '<version>'}" there (Deno resolves npm: imports from the root node_modules)`,
          );
        } else if (!EXACT_VERSION.test(pin)) {
          rangePins.add(name);
        } else if (version === undefined) {
          problems.push(
            `${path}: "${specifier}" has no version; write "npm:${name}@${pin}${subpath}"`,
          );
        } else if (version !== pin) {
          problems.push(
            `${path}: "${specifier}" does not match the root package.json pin "${pin}"; change the specifier to "npm:${name}@${pin}${subpath}" (or update the pin and every specifier together)`,
          );
        }
      }
    }
  }
  for (const name of [...rangePins].sort()) {
    problems.push(
      `package.json: devDependency "${name}" is "${devDependencies[name]}", used by an Edge Function through npm:; pin it to an exact version`,
    );
  }
  return problems;
}
