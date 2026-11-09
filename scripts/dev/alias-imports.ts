#!/usr/bin/env bun
/**
 * Converts relative imports that leave their top-level folder to the app's
 * `@/` alias. The top-level folder of a file under `src/` is `app/`,
 * `shared/`, or `features/<domain>/`; files directly under `src/` form one group.
 * Rewrites import, export, `import()`, `require()`, and `mock.module`
 * specifiers in `src/**`, tests included, and leaves the rest as they are.
 *
 *   bun scripts/dev/alias-imports.ts <app> [--apply] [--root <repoRoot>]
 *
 * <app> is a repo-relative app folder such as `apps/admin-web`. Without
 * `--apply` it only prints the plan. `--root` defaults to this repository.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { ALIAS_APPS, SPEC_CONTEXTS, tokenize } from './move-files';

const posix = path.posix;
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const USAGE =
  'Usage: bun scripts/dev/alias-imports.ts <app> [--apply] [--root <repoRoot>]';

interface Args {
  app: string;
  apply: boolean;
  root: string;
}

function parseArgs(argv: string[]): Args {
  let app: string | undefined;
  let apply = false;
  let root = path.join(import.meta.dir, '..', '..');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') apply = true;
    else if (arg === '--root') {
      const value = argv[++i];
      if (!value) throw new Error('--root needs a value.');
      root = value;
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}.`);
    else if (!app) app = arg;
    else throw new Error(`Unexpected argument ${arg}.`);
  }
  if (!app) throw new Error(USAGE);
  app = posix.normalize(app.replace(/\\/g, '/')).replace(/\/$/, '');
  return { app, apply, root: path.resolve(root) };
}

/** Folder that owns a path relative to `src/`: `app`, `shared`, `features/<domain>`, or `.` for the files directly under `src/`. */
function ownerOf(srcPath: string, isDir = false): string {
  const parts = srcPath.split('/');
  if (parts.length === 1) return isDir ? srcPath : '.';
  return parts[0] === 'features' ? parts.slice(0, 2).join('/') : parts[0];
}

function walk(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(dir, rel), {
    withFileTypes: true,
  })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...walk(dir, childRel));
    } else if (entry.isFile() && SCAN_EXTS.has(posix.extname(entry.name))) {
      out.push(childRel);
    }
  }
  return out;
}

function main(): number {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  const { app, apply, root } = args;
  const alias = ALIAS_APPS[app]?.find(([prefix]) => prefix === '@/');
  if (!alias) {
    console.error(
      `${app} has no @/ alias; known apps: ${Object.keys(ALIAS_APPS).join(', ')}`,
    );
    return 1;
  }
  const srcDir = `${app}/${alias[1]}`;
  if (!existsSync(path.join(root, srcDir))) {
    console.error(`${srcDir} does not exist under ${root}.`);
    return 1;
  }

  const rewrites: string[] = [];
  const manual: string[] = [];
  let filesEdited = 0;

  for (const srcFile of walk(path.join(root, srcDir))) {
    const file = `${srcDir}/${srcFile}`;
    const text = readFileSync(path.join(root, file), 'utf8');
    const owner = ownerOf(srcFile);
    const lineAt = (offset: number): number =>
      text.slice(0, offset).split('\n').length;
    const edits: { start: number; end: number; text: string }[] = [];

    for (const token of tokenize(text)) {
      const before = text.slice(Math.max(0, token.open - 80), token.open);
      if (!SPEC_CONTEXTS.some((re) => re.test(before))) continue;
      const first = token.quasis[0];
      const spec = text.slice(first.start, first.end);
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
      if (token.hasExpr) {
        manual.push(
          `${file}:${lineAt(token.open)}: template specifier not rewritten`,
        );
        continue;
      }
      const target = posix.normalize(posix.join(posix.dirname(srcFile), spec));
      if (target.startsWith('../')) continue;
      // `./shared` from a root file names the folder (its index), not a sibling.
      const isDir =
        !target.includes('/') &&
        existsSync(path.join(root, srcDir, target)) &&
        statSync(path.join(root, srcDir, target)).isDirectory();
      if (ownerOf(target, isDir) === owner) continue;
      const next = alias[0] + target;
      edits.push({ start: first.start, end: first.end, text: next });
      rewrites.push(`  ${file}:${lineAt(first.start)}: ${spec} -> ${next}`);
    }

    if (edits.length === 0) continue;
    filesEdited++;
    if (apply) {
      let updated = text;
      for (const edit of edits.reverse()) {
        updated =
          updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);
      }
      writeFileSync(path.join(root, file), updated);
    }
  }

  const lines = [apply ? 'Rewrites:' : 'Planned rewrites (dry run):'];
  lines.push(...(rewrites.length > 0 ? rewrites : ['  (none)']));
  lines.push('Items to check manually:');
  lines.push(
    ...(manual.length > 0 ? manual.map((m) => `  ${m}`) : ['  (none)']),
  );
  lines.push(
    `Summary${apply ? '' : ' (dry run, nothing changed)'}: ${filesEdited} files edited, ${rewrites.length} specifiers rewritten, ${manual.length} items to check manually`,
  );
  console.log(lines.join('\n'));
  return 0;
}

if (import.meta.main) process.exit(main());
