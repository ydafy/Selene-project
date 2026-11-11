// Guard for the agent instruction files and the docs: every repository path and
// `bun run` script they cite must exist, so a rename or a moved script cannot
// leave agents or readers following a dead reference. Checked by
// agent-instructions.test.ts.
import { readFileSync } from 'node:fs';
import { posix, join } from 'node:path';

export type InstructionFile = { path: string; text: string };
export type ScriptReference = { workspace: string; script: string };

// Cited paths that are not in the repository. Each needs a reason, and the test
// fails when no instruction file cites it anymore.
export const NOT_IN_REPO: Record<string, string> = {
  'C:/dev/School-portal': 'main checkout on the maintainer machine',
  'C:/dev/School-portal-worktrees': 'worktree parent on the maintainer machine',
  'C:/dev/School-portal-worktrees/':
    'worktree parent on the maintainer machine',
  '~/.supabase/stacks': 'per-user Supabase CLI state',
  '~/.supabase/stacks/': 'per-user Supabase CLI state',
  '~/.gentle-shell/agent/sessions/': 'per-user Gentle Shell session logs',
  '~/.gentle-shell/agent/gentle-agents/sessions/':
    'per-user Gentle Shell session logs',
  'mcp.json': 'user-level MCP configuration',
  'selene-ze/selene-edge-functions': 'Sentry organization and project slug',
  'ydafy/Selene-project': 'GitHub repository slug',
  '.link.json': 'gitignored Supabase CLI file',
  'bruno/.env': 'gitignored, written by bun run bruno:env',
  'supabase/functions/.env': 'gitignored, maintainer-owned secrets',
  '.local/': 'gitignored scratch folder',
  '.local/*.pid': 'gitignored scratch files',
  'verification-evidence/': 'gitignored evidence folder',
  'test-results/': 'gitignored Playwright output',
  'apps/frontend/node_modules/expo/bundledNativeModules.json':
    'installed dependency file',
  'apps/frontend/credentials.json': 'gitignored EAS signing file',
  'apps/frontend/credentials/': 'gitignored EAS signing files',
  'apps/frontend/credentials/android/keystore.jks':
    'deleted from the tree, still in Git history',
  'apps/frontend/google-services.json': 'gitignored Firebase file',
  'supabase/.temp/postgres-version': 'gitignored Supabase CLI file',
  '.atl/skill-registry.md':
    'gitignored index, written by gentle-ai skill-registry refresh',
  'state.json': 'per-user Supabase stack file in ~/.supabase/stacks',
  'origin/main': 'Git remote-tracking branch',
  'feat/shipment-cancellations-b5': 'Git branch name',
  'oven-sh/setup-bun': 'GitHub Actions action id',
  'git/ref': 'GitHub REST API endpoint name',
  'generaltrack/': 'Envia API endpoint',
  'import-x/no-restricted-paths': 'ESLint rule id',
  'check-file/filename-naming-convention': 'ESLint rule id',
  '*/N': 'cron schedule syntax',
};

const PATH_EXTENSION =
  /\.(md|ts|tsx|js|json|jsonc|toml|ya?ml|sql|lock|bru|sh|ps1)$/;
// Placeholders (`<feature>`), shell syntax, and assignments are not paths.
const NOT_A_PATH = /:\/\/|^@|[<>{}$='"]|^\.\w+$/;

const trimPunctuation = (token: string) =>
  token.replace(/^\(+/, '').replace(/[,.;:)]+$/, '');

export function extractPathReferences(markdown: string): string[] {
  const references: string[] = [];
  for (const [, span] of markdown.matchAll(/`([^`\n]+)`/g)) {
    const tokens = span.trim().split(/\s+/);
    if (tokens.length === 1) {
      const token = trimPunctuation(tokens[0]);
      if (
        (token.includes('/') || PATH_EXTENSION.test(token)) &&
        !NOT_A_PATH.test(token)
      ) {
        references.push(token);
      }
      continue;
    }
    // Inside a command, only a token with a directory is a path claim; the
    // caller keeps those that start at a top-level repository entry.
    for (const raw of tokens) {
      const token = trimPunctuation(raw);
      if (token.includes('/') && !NOT_A_PATH.test(token)) {
        references.push(`${COMMAND_MARK}${token}`);
      }
    }
  }
  for (const [, target] of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (!NOT_A_PATH.test(target) && !target.startsWith('#')) {
      references.push(target.split('#')[0]);
    }
  }
  return references;
}

const COMMAND_MARK = '\0';

export function extractScriptReferences(markdown: string): ScriptReference[] {
  const references: ScriptReference[] = [];
  const pattern = /\bbun run (?:--filter[ =](\S+) )?([A-Za-z0-9:_.-]+)/g;
  for (const [, filter, script] of markdown.matchAll(pattern)) {
    if (filter?.includes('<')) continue;
    references.push({
      workspace: filter ?? '',
      script: script.replace(/\.+$/, ''),
    });
  }
  return references;
}

export function findBrokenReferences(input: {
  files: InstructionFile[];
  repoFiles: string[];
  scripts: Map<string, Set<string>>;
  notInRepo: Record<string, string>;
}): string[] {
  const files = new Set(input.repoFiles);
  const directories = new Set<string>();
  for (const file of input.repoFiles) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) {
      directories.add(parts.slice(0, i).join('/'));
    }
  }
  const topLevel = new Set(input.repoFiles.map((file) => file.split('/')[0]));

  const exists = (candidate: string) => {
    const path = posix.normalize(candidate).replace(/\/$/, '');
    if (path.includes('*')) {
      const glob = new Bun.Glob(path);
      return [...files, ...directories].some((entry) => glob.match(entry));
    }
    return files.has(path) || directories.has(path);
  };

  const problems: string[] = [];
  for (const file of input.files) {
    const directory = posix.dirname(file.path);
    for (const reference of extractPathReferences(file.text)) {
      const inCommand = reference.startsWith(COMMAND_MARK);
      const path = inCommand ? reference.slice(1) : reference;
      if (path in input.notInRepo) continue;
      if (inCommand && !topLevel.has(path.split('/')[0])) continue;
      // A leading slash is an app route (`/privacidad`) unless it starts at a
      // top-level repository entry; then it is a root path such as `/docs/x.md`.
      if (path.startsWith('/')) {
        if (!topLevel.has(path.split('/')[1])) continue;
        if (!exists(path.slice(1))) {
          problems.push(`${file.path}: path \`${path}\` does not exist`);
        }
        continue;
      }
      // A `./` or `../` path resolves only from the citing file. Other paths
      // resolve from the repository root, from the citing file, or, for
      // request names, from the Bruno collection.
      const relative = path.startsWith('./') || path.startsWith('../');
      const bases = relative ? [directory] : ['', directory, 'bruno'];
      if (!bases.some((base) => exists(posix.join(base, path)))) {
        problems.push(`${file.path}: path \`${path}\` does not exist`);
      }
    }
    for (const { workspace, script } of extractScriptReferences(file.text)) {
      const label = workspace === '' ? 'the root' : `the ${workspace}`;
      if (!input.scripts.get(workspace)?.has(script)) {
        problems.push(
          `${file.path}: script \`${script}\` is not in ${label} package.json`,
        );
      }
    }
  }
  return [...new Set(problems)];
}

export function findStaleAllowlistEntries(
  files: InstructionFile[],
  notInRepo: Record<string, string>,
): string[] {
  const cited = new Set(
    files.flatMap((file) =>
      extractPathReferences(file.text).map((reference) =>
        reference.replace(COMMAND_MARK, ''),
      ),
    ),
  );
  return Object.keys(notInRepo).filter((path) => !cited.has(path));
}

export function readLineBudget(markdown: string): number | undefined {
  const match = /Keep it at most (\d+) lines/.exec(markdown);
  return match ? Number(match[1]) : undefined;
}

export function countLines(text: string): number {
  return text.replace(/\r?\n$/, '').split(/\r?\n/).length;
}

// Anthropic's guidance for always-loaded instruction files.
const MAX_LINE_BUDGET = 200;

export function checkLineBudget(markdown: string): string | undefined {
  const budget = readLineBudget(markdown);
  if (budget === undefined) return 'no "Keep it at most N lines" note';
  if (budget > MAX_LINE_BUDGET) {
    return `the budget of ${budget} lines is over the ${MAX_LINE_BUDGET}-line maximum`;
  }
  const lines = countLines(markdown);
  if (lines > budget) return `${lines} lines, over the budget of ${budget}`;
  return undefined;
}

// Tracked and untracked-but-not-ignored files, so a gitignored path counts as
// missing here exactly as it is missing in CI.
export function listRepoFiles(root: string): string[] {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value;
  }
  const result = Bun.spawnSync(
    ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, env },
  );
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().split('\0').filter(Boolean);
}

// Every AGENTS.md, every Markdown file of our own skills (the ones under
// .agents/skills that the skills CLI does not manage, see skills-lock.json),
// and every Markdown file under docs/, subfolders included.
export function collectInstructionFiles(
  root: string,
  repoFiles: string[],
): InstructionFile[] {
  const lock = JSON.parse(readFileSync(join(root, 'skills-lock.json'), 'utf8'));
  const vendor = new Set(Object.keys(lock.skills));
  return repoFiles
    .filter((file) => {
      if (/^docs\/.+\.md$/.test(file)) return true;
      if (file === 'AGENTS.md' || file.endsWith('/AGENTS.md')) {
        return !file.startsWith('.agents/');
      }
      const skill = /^\.agents\/skills\/([^/]+)\/.+\.md$/.exec(file);
      return skill !== null && !vendor.has(skill[1]);
    })
    .sort()
    .map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));
}

// Scripts by workspace: '' is the root package.json, the rest by package name.
export function readWorkspaceScripts(root: string): Map<string, Set<string>> {
  const read = (path: string) =>
    JSON.parse(readFileSync(join(root, path), 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
      workspaces?: string[];
    };
  const rootManifest = read('package.json');
  const scripts = new Map([
    ['', new Set(Object.keys(rootManifest.scripts ?? {}))],
  ]);
  for (const pattern of rootManifest.workspaces ?? []) {
    for (const path of new Bun.Glob(`${pattern}/package.json`).scanSync(root)) {
      const manifest = read(path);
      if (manifest.name) {
        scripts.set(
          manifest.name,
          new Set(Object.keys(manifest.scripts ?? {})),
        );
      }
    }
  }
  return scripts;
}
