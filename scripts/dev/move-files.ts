#!/usr/bin/env bun
/**
 * Codemod for layout moves: moves files with `git mv` and rewrites every
 * reference to them (alias, relative, `mock.module`, and `import()` specifiers,
 * and path strings) across the repository.
 *
 *   bun scripts/dev/move-files.ts <mapping.json> [--dry-run] [--root <repoRoot>]
 *
 * mapping.json is an array of [oldPath, newPath] pairs: repo-relative POSIX
 * paths of files (not directories). `--root` defaults to this repository.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const posix = path.posix;

// The `@/` alias of each app, as its tsconfig `paths` define it. A file under
// an app resolves `@/` against that app only; the more specific prefix goes first.
const ALIAS_APPS: Record<string, [prefix: string, dir: string][]> = {
  'apps/frontend': [
    ['@/assets/', 'assets'],
    ['@/', 'src'],
  ],
  'apps/admin-web': [['@/', 'src']],
};
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.agents',
  '.local',
  'dist',
  'build',
  '.expo',
  'android',
  'ios',
]);
const RESOLVE_EXTS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.png',
  '.webp',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ttf',
  '.otf',
  '.mp3',
  '.mp4',
  '.ico',
];
const INDEX_FILES = ['index.ts', 'index.tsx'];
const SPEC_CONTEXTS = [
  /\bfrom\s*$/,
  /\bimport\s*$/,
  /\bimport\s*\(\s*$/,
  /\brequire\s*\(\s*$/,
  /\bmock\s*\.\s*module\s*\(\s*$/,
  /\bjest\s*\.\s*mock\s*\(\s*$/,
];
const URL_BEFORE = /\bnew\s+URL\s*\(\s*$/;
const URL_AFTER = /^\s*,\s*import\.meta\.url\b/;
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'typeof',
  'case',
  'delete',
  'void',
  'throw',
  'in',
  'of',
  'new',
  'else',
  'do',
  'instanceof',
  'yield',
  'await',
]);

type Pair = [string, string];

interface Quasi {
  start: number;
  end: number;
  /** Source text of the `${...}` expression right before this quasi. */
  prevExpr: string | null;
}

interface Token {
  /** Index of the opening quote or backtick. */
  open: number;
  quasis: Quasi[];
  hasExpr: boolean;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface FileResult {
  edits: Edit[];
  specifiers: number;
  pathStrings: number;
  manual: string[];
}

// ---------- tokenizer ----------

/** Finds string literals and template literals, skipping comments and regexes. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const n = text.length;

  function scanString(open: number, quote: string): number {
    let i = open + 1;
    while (i < n) {
      const c = text[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) {
        tokens.push({
          open,
          quasis: [{ start: open + 1, end: i, prevExpr: null }],
          hasExpr: false,
        });
        return i + 1;
      }
      // Unterminated on this line (an apostrophe in JSX text, for example).
      if (c === '\n') return i;
      i++;
    }
    return n;
  }

  function scanRegex(open: number): number {
    let i = open + 1;
    let inClass = false;
    while (i < n) {
      const c = text[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '\n') return i;
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        i++;
        while (i < n && /[a-z]/i.test(text[i])) i++;
        return i;
      }
      i++;
    }
    return n;
  }

  function scanTemplate(open: number): number {
    const quasis: Quasi[] = [];
    let i = open + 1;
    let quasiStart = i;
    let prevExpr: string | null = null;
    while (i < n) {
      const c = text[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        quasis.push({ start: quasiStart, end: i, prevExpr });
        i++;
        break;
      }
      if (c === '$' && text[i + 1] === '{') {
        quasis.push({ start: quasiStart, end: i, prevExpr });
        const exprStart = i + 2;
        const close = scanCode(exprStart, true);
        prevExpr = text.slice(exprStart, close).trim();
        i = close + 1;
        quasiStart = i;
        continue;
      }
      i++;
    }
    tokens.push({ open, quasis, hasExpr: quasis.length > 1 });
    return i;
  }

  function scanCode(start: number, nested: boolean): number {
    let i = start;
    let depth = 0;
    let valueLike = false;
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        i++;
        continue;
      }
      if (c === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end < 0 ? n : end + 2;
        continue;
      }
      if (c === '"' || c === "'") {
        i = scanString(i, c);
        valueLike = true;
        continue;
      }
      if (c === '`') {
        i = scanTemplate(i);
        valueLike = true;
        continue;
      }
      if (c === '/') {
        if (valueLike || text[i - 1] === '<') {
          i++;
          valueLike = false;
        } else {
          i = scanRegex(i);
          valueLike = true;
        }
        continue;
      }
      if (c === '{') {
        depth++;
        i++;
        valueLike = false;
        continue;
      }
      if (c === '}') {
        if (nested && depth === 0) return i;
        depth--;
        i++;
        valueLike = true;
        continue;
      }
      if (/[\w$]/.test(c)) {
        let j = i;
        while (j < n && /[\w$]/.test(text[j])) j++;
        valueLike = !REGEX_PRECEDING_KEYWORDS.has(text.slice(i, j));
        i = j;
        continue;
      }
      valueLike = c === ')' || c === ']';
      i++;
    }
    return n;
  }

  scanCode(0, false);
  return tokens.sort((a, b) => a.open - b.open);
}

// ---------- helpers ----------

const toPosix = (p: string): string => p.replace(/\\/g, '/');

/** `apps/<name>` for a file inside an app, or null. */
function appRootOf(file: string): string | null {
  return /^apps\/[^/]+(?=\/)/.exec(file)?.[0] ?? null;
}

function normalizeRepoPath(p: string): string {
  const n = posix.normalize(toPosix(p));
  return n.startsWith('./') ? n.slice(2) : n;
}

/** Relative path between two repo-relative paths; `fromDir` is a directory. */
function relative(fromDir: string, to: string): string {
  return posix.relative(`/${fromDir === '.' ? '' : fromDir}`, `/${to}`);
}

function dotPrefixed(rel: string): string {
  if (rel === '') return '.';
  if (rel === '.' || rel === '..') return rel;
  return rel.startsWith('./') || rel.startsWith('../') ? rel : `./${rel}`;
}

function stripExt(p: string): string {
  const ext = posix.extname(p);
  return ext ? p.slice(0, -ext.length) : p;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (rel: string): void => {
    const abs = rel ? path.join(root, rel) : root;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  };
  visit('');
  return out;
}

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout.toString();
}

// ---------- validation ----------

function loadMapping(file: string): Pair[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read mapping ${file}: ${(error as Error).message}`);
  }
  if (!Array.isArray(raw)) throw new Error('Mapping must be a JSON array.');
  return raw.map((pair, i) => {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== 'string' ||
      typeof pair[1] !== 'string'
    ) {
      throw new Error(`Mapping entry ${i} must be [oldPath, newPath].`);
    }
    return [normalizeRepoPath(pair[0]), normalizeRepoPath(pair[1])] as Pair;
  });
}

function validate(root: string, pairs: Pair[]): string[] {
  const errors: string[] = [];
  const oldSet = new Set(pairs.map(([o]) => o));
  const seenOld = new Set<string>();
  const seenNew = new Set<string>();
  for (const [oldPath, newPath] of pairs) {
    if (oldPath === newPath)
      errors.push(`Old and new path are the same: ${oldPath}`);
    if (seenOld.has(oldPath)) errors.push(`Duplicate old path: ${oldPath}`);
    if (seenNew.has(newPath)) errors.push(`Duplicate new path: ${newPath}`);
    seenOld.add(oldPath);
    seenNew.add(newPath);

    const oldAbs = path.join(root, oldPath);
    if (!existsSync(oldAbs) || !statSync(oldAbs).isFile()) {
      errors.push(`Old path does not exist as a file: ${oldPath}`);
    }
    const caseOnly =
      oldPath !== newPath && oldPath.toLowerCase() === newPath.toLowerCase();
    if (
      existsSync(path.join(root, newPath)) &&
      !oldSet.has(newPath) &&
      !caseOnly
    ) {
      errors.push(`New path already exists: ${newPath}`);
    }
  }
  return errors;
}

// ---------- main ----------

interface Args {
  mapping: string;
  dryRun: boolean;
  root: string;
}

function parseArgs(argv: string[]): Args {
  let mapping: string | undefined;
  let dryRun = false;
  let root = path.join(import.meta.dir, '..', '..');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--root') {
      const value = argv[++i];
      if (!value) throw new Error('--root needs a value.');
      root = value;
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}.`);
    else if (!mapping) mapping = arg;
    else throw new Error(`Unexpected argument ${arg}.`);
  }
  if (!mapping) {
    throw new Error(
      'Usage: bun scripts/dev/move-files.ts <mapping.json> [--dry-run] [--root <repoRoot>]',
    );
  }
  return { mapping, dryRun, root: path.resolve(root) };
}

function main(): number {
  let args: Args;
  let pairs: Pair[];
  try {
    args = parseArgs(process.argv.slice(2));
    pairs = loadMapping(args.mapping);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  const { root, dryRun } = args;

  const errors = validate(root, pairs);
  if (errors.length > 0) {
    console.error('Validation failed, nothing was changed:');
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }

  const moves = new Map<string, string>(pairs);
  const allFiles = walk(root);
  const fileSet = new Set(allFiles);
  // Moved files may live in directories the walk skips; resolution still sees them.
  for (const [oldPath] of pairs) fileSet.add(oldPath);

  const basenames = new Set<string>();
  for (const [oldPath] of pairs) {
    const base = stripExt(posix.basename(oldPath));
    if (base !== 'index') basenames.add(base);
  }
  const names = [...basenames]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex);
  const reportRegex =
    names.length > 0
      ? new RegExp(
          `(?<=/)(?:${names.join('|')})(?![\\w-])|(?<![\\w-])(?:${names.join('|')})(?=\\.tsx?\\b)`,
        )
      : null;

  function resolveBase(
    base: string,
  ): { file: string; kind: 'exact' | 'ext' | 'index' } | null {
    if (fileSet.has(base)) return { file: base, kind: 'exact' };
    for (const ext of RESOLVE_EXTS) {
      if (fileSet.has(base + ext)) return { file: base + ext, kind: 'ext' };
    }
    for (const index of INDEX_FILES) {
      const candidate = posix.join(base, index);
      if (fileSet.has(candidate)) return { file: candidate, kind: 'index' };
    }
    return null;
  }

  /** Returns the new specifier text, or null when it stays as it is. */
  function rewriteSpecifier(
    file: string,
    fileNew: string,
    spec: string,
  ): { text: string | null; resolved: boolean; note?: string } {
    const isRel =
      spec === '.' ||
      spec === '..' ||
      spec.startsWith('./') ||
      spec.startsWith('../');
    const app = appRootOf(file);
    const aliases = app ? ALIAS_APPS[app] : undefined;
    const alias = isRel
      ? undefined
      : aliases?.find(([prefix]) => spec.startsWith(prefix));
    const isAlias = alias !== undefined;
    if (!isRel && !isAlias) return { text: null, resolved: true };

    const fileMoved = fileNew !== file;
    let basePath: string;
    if (alias)
      basePath = posix.join(
        app as string,
        alias[1],
        spec.slice(alias[0].length),
      );
    else basePath = posix.join(posix.dirname(file), spec);
    if (basePath.length > 1 && basePath.endsWith('/'))
      basePath = basePath.slice(0, -1);
    const trailingSlash = spec.endsWith('/') && spec.length > 1 ? '/' : '';

    const resolution = resolveBase(basePath);
    let targetPath: string;
    if (!resolution) {
      if (!(isRel && fileMoved)) return { text: null, resolved: false };
      targetPath = basePath;
    } else {
      const target = resolution.file;
      const newTarget = moves.get(target) ?? target;
      if (newTarget === target && !(isRel && fileMoved)) {
        return { text: null, resolved: true };
      }
      if (resolution.kind === 'exact') targetPath = newTarget;
      else if (resolution.kind === 'ext') targetPath = stripExt(newTarget);
      else if (INDEX_FILES.includes(posix.basename(newTarget))) {
        targetPath = posix.dirname(newTarget);
      } else targetPath = stripExt(newTarget);
    }

    let text: string;
    let note: string | undefined;
    // A moved file uses the alias of the app it moves to.
    const newApp = appRootOf(fileNew);
    const newAlias = isAlias
      ? (newApp ? ALIAS_APPS[newApp] : undefined)?.find(([, dir]) =>
          targetPath.startsWith(`${newApp}/${dir}/`),
        )
      : undefined;
    if (newAlias) {
      text = newAlias[0] + targetPath.slice(`${newApp}/${newAlias[1]}/`.length);
    } else {
      text = dotPrefixed(relative(posix.dirname(fileNew), targetPath));
      if (isAlias)
        note = 'alias target moved outside the alias roots; now relative';
    }
    text += trailingSlash;
    return { text: text === spec ? null : text, resolved: true, note };
  }

  /** Returns the new path-string text, or null when it stays as it is. */
  function rewritePathString(
    file: string,
    fileNew: string,
    raw: string,
    afterExpr: boolean,
    urlMode: boolean,
  ): string | null {
    let content = raw;
    let lead = '';
    if (afterExpr && content.startsWith('/')) {
      lead = '/';
      content = content.slice(1);
    }
    if (!content || /[\s:]/.test(content) || content.startsWith('/'))
      return null;
    const fileDir = posix.dirname(file);
    const explicitRel = content.startsWith('./') || content.startsWith('../');
    const app = appRootOf(file);
    const bases = urlMode ? [fileDir] : [fileDir, ...(app ? [app] : []), '.'];
    for (const base of bases) {
      const p = posix.normalize(posix.join(base, content));
      if (p.startsWith('../')) continue;
      let newTarget = moves.get(p);
      if (
        newTarget === undefined &&
        base === fileDir &&
        fileNew !== file &&
        (explicitRel || urlMode) &&
        fileSet.has(p)
      ) {
        newTarget = p;
      }
      if (newTarget === undefined) continue;
      const baseNewDir = base === fileDir ? posix.dirname(fileNew) : base;
      let rel = relative(baseNewDir, newTarget);
      if (content.startsWith('./') && !rel.startsWith('.')) rel = `./${rel}`;
      const text = lead + rel;
      return text === raw ? null : text;
    }
    return null;
  }

  const results = new Map<string, FileResult>();
  const contents = new Map<string, string>();

  for (const file of allFiles) {
    if (!SCAN_EXTS.has(posix.extname(file))) continue;
    const text = readFileSync(path.join(root, file), 'utf8');
    const fileNew = moves.get(file) ?? file;
    const result: FileResult = {
      edits: [],
      specifiers: 0,
      pathStrings: 0,
      manual: [],
    };
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++)
      if (text[i] === '\n') lineStarts.push(i + 1);
    const lineAt = (offset: number): number => {
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    };
    const short = (s: string): string => {
      const flat = s.replace(/\s+/g, ' ');
      return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
    };
    const report = (offset: number, message: string): void => {
      result.manual.push(`${file}:${lineAt(offset)}: ${message}`);
    };

    for (const token of tokenize(text)) {
      const before = text.slice(Math.max(0, token.open - 80), token.open);
      const isSpecifierContext = SPEC_CONTEXTS.some((re) => re.test(before));

      if (token.hasExpr) {
        if (isSpecifierContext) {
          const first = text.slice(token.quasis[0].start, token.quasis[0].end);
          if (first.startsWith('.') || first.startsWith('@/')) {
            const last = token.quasis[token.quasis.length - 1];
            report(
              token.open,
              `template specifier not rewritten: \`${short(text.slice(token.open + 1, last.end))}\``,
            );
          }
          continue;
        }
        for (const quasi of token.quasis) {
          const raw = text.slice(quasi.start, quasi.end);
          const next = rewritePathString(
            file,
            fileNew,
            raw,
            quasi.prevExpr !== null,
            false,
          );
          if (next !== null) {
            result.edits.push({
              start: quasi.start,
              end: quasi.end,
              text: next,
            });
            result.pathStrings++;
          } else if (reportRegex?.test(raw)) {
            report(quasi.start, short(raw));
          }
        }
        continue;
      }

      const quasi = token.quasis[0];
      const raw = text.slice(quasi.start, quasi.end);
      if (isSpecifierContext) {
        const outcome = rewriteSpecifier(file, fileNew, raw);
        if (outcome.text !== null) {
          result.edits.push({
            start: quasi.start,
            end: quasi.end,
            text: outcome.text,
          });
          result.specifiers++;
          if (outcome.note) report(quasi.start, `${raw}: ${outcome.note}`);
        } else if (!outcome.resolved && reportRegex?.test(raw)) {
          report(quasi.start, short(raw));
        }
        continue;
      }
      const urlMode =
        URL_BEFORE.test(before) &&
        URL_AFTER.test(text.slice(quasi.end + 1, quasi.end + 80));
      const next = rewritePathString(file, fileNew, raw, false, urlMode);
      if (next !== null) {
        result.edits.push({ start: quasi.start, end: quasi.end, text: next });
        result.pathStrings++;
      } else if (reportRegex?.test(raw)) {
        report(quasi.start, short(raw));
      }
    }

    if (result.edits.length > 0 || result.manual.length > 0)
      results.set(file, result);
    if (result.edits.length > 0) {
      let updated = text;
      for (const edit of [...result.edits].sort((a, b) => b.start - a.start)) {
        updated =
          updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);
      }
      contents.set(file, updated);
    }
  }

  // ---------- output / apply ----------

  const lines: string[] = [];
  lines.push(dryRun ? 'Planned moves (dry run):' : 'Moves:');
  for (const [oldPath, newPath] of pairs)
    lines.push(`  ${oldPath} -> ${newPath}`);

  const edited = [...results].filter(([, r]) => r.edits.length > 0);
  lines.push('Rewrites per file:');
  if (edited.length === 0) lines.push('  (none)');
  for (const [file, r] of edited) {
    const dest = moves.get(file);
    lines.push(
      `  ${file}${dest ? ` (moves to ${dest})` : ''}: ${r.specifiers} specifiers, ${r.pathStrings} path strings`,
    );
  }
  const manual = [...results.values()].flatMap((r) => r.manual);
  const specifiers = [...results.values()].reduce(
    (s, r) => s + r.specifiers,
    0,
  );
  const pathStrings = [...results.values()].reduce(
    (s, r) => s + r.pathStrings,
    0,
  );

  if (!dryRun) {
    for (const [file, updated] of contents) {
      writeFileSync(path.join(root, file), updated);
    }
    applyMoves(root, pairs);
  }

  lines.push('Items to check manually:');
  if (manual.length === 0) lines.push('  (none)');
  for (const m of manual) lines.push(`  ${m}`);
  lines.push(
    `Summary${dryRun ? ' (dry run, nothing changed)' : ''}: ${pairs.length} files moved, ${edited.length} files edited, ${specifiers} specifiers rewritten, ${pathStrings} path strings rewritten, ${manual.length} items to check manually`,
  );
  console.log(lines.join('\n'));
  return 0;
}

function applyMoves(root: string, pairs: Pair[]): void {
  const tracked = new Set(
    git(root, ['ls-files', '-z']).split('\0').filter(Boolean),
  );
  const oldSet = new Set(pairs.map(([o]) => o));
  const move = (from: string, to: string): void => {
    mkdirSync(path.join(root, posix.dirname(to)), { recursive: true });
    if (tracked.has(from)) git(root, ['mv', from, to]);
    else renameSync(path.join(root, from), path.join(root, to));
  };

  // Moves whose target is another moved file, or that only change case, go
  // through a temporary name so they cannot collide.
  const tricky = pairs.filter(
    ([o, n]) => oldSet.has(n) || o.toLowerCase() === n.toLowerCase(),
  );
  const plain = pairs.filter((pair) => !tricky.includes(pair));
  const temp = (o: string): string => `${o}.__move_files_tmp__`;

  for (const [o] of tricky) {
    move(o, temp(o));
    if (tracked.has(o)) {
      tracked.delete(o);
      tracked.add(temp(o));
    }
  }
  for (const [o, n] of plain) move(o, n);
  for (const [o, n] of tricky) move(temp(o), n);
}

process.exit(main());
