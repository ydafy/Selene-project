// Guard for the commands in Git hooks and package.json scripts: every file or
// folder they run must exist, so a moved script fails a test instead of failing
// silently (a hook line ending in `|| true` hides it). Checked by
// script-paths.test.ts.
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { listRepoFiles } from './agent-instructions';

export type ScriptSource = {
  label: string;
  // Folder the command runs from, relative to the repository root ('' is the root).
  directory: string;
  command: string;
};

// Paths the commands use that are not in the repository. Each needs a reason,
// and the test fails when no command uses it anymore.
export const SCRIPT_PATHS_NOT_IN_REPO: Record<string, string> = {
  'supabase/functions/.env':
    'gitignored, maintainer-owned secrets read by functions:serve',
};

// Hooks resolve their scripts next to the hook: `"$(dirname "$0")/../x"`.
const HOOK_ROOT = '"$(dirname "$0")/../';
const FILE_EXTENSION =
  /\.(ts|tsx|js|mjs|cjs|json|jsonc|ya?ml|sh|sql|toml|env)$/;
// Flags, packages, globs, variables, URLs, and lists are not paths.
const NOT_A_PATH = /^-|^@|[*$<>{}=,]|:\/\//;

type CommandPaths = { paths: string[]; folders: string[] };

function extractCommandPaths(command: string): CommandPaths {
  const tokens = command
    .replaceAll(HOOK_ROOT, '"')
    .split(/\s+/)
    .map((token) => token.replace(/^['"]+|['"]+$/g, ''))
    .filter(Boolean);
  const paths: string[] = [];
  const folders: string[] = [];
  tokens.forEach((token, index) => {
    if (NOT_A_PATH.test(token)) return;
    if (tokens[index - 1] === 'cd') folders.push(token);
    else if (token.includes('/') || FILE_EXTENSION.test(token)) {
      paths.push(token);
    }
  });
  return { paths, folders };
}

export function findBrokenScriptPaths(input: {
  sources: ScriptSource[];
  repoFiles: string[];
  notInRepo: Record<string, string>;
}): string[] {
  const entries = new Set(input.repoFiles);
  for (const file of input.repoFiles) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) {
      entries.add(parts.slice(0, i).join('/'));
    }
  }
  const exists = (path: string) =>
    entries.has(posix.normalize(path).replace(/\/$/, ''));

  const problems: string[] = [];
  for (const { label, directory, command } of input.sources) {
    const { paths, folders } = extractCommandPaths(command);
    const report = (path: string) =>
      problems.push(`${label}: \`${path}\` does not exist`);
    for (const folder of folders) {
      if (!exists(posix.join(directory, folder))) report(folder);
    }
    // A path resolves from the command's folder or from a folder it enters.
    const bases = [
      directory,
      ...folders.map((folder) => posix.join(directory, folder)),
    ];
    for (const path of paths) {
      if (path in input.notInRepo) continue;
      if (!bases.some((base) => exists(posix.join(base, path)))) report(path);
    }
  }
  return problems;
}

export function findStaleScriptAllowlist(
  sources: ScriptSource[],
  notInRepo: Record<string, string>,
): string[] {
  const used = new Set(
    sources.flatMap((source) => extractCommandPaths(source.command).paths),
  );
  return Object.keys(notInRepo).filter((path) => !used.has(path));
}

// Every line of every Git hook, and every script of the root and workspace
// package.json files.
export function collectScriptSources(root: string): ScriptSource[] {
  const sources: ScriptSource[] = [];
  const hooks = listRepoFiles(root).filter((file) =>
    /^\.husky\/[^/]+$/.test(file),
  );
  for (const hook of hooks.sort()) {
    for (const line of readFileSync(join(root, hook), 'utf8').split(/\r?\n/)) {
      const command = line.trim();
      if (command && !command.startsWith('#')) {
        sources.push({ label: hook, directory: '', command });
      }
    }
  }

  const read = (path: string) =>
    JSON.parse(readFileSync(join(root, path), 'utf8')) as {
      scripts?: Record<string, string>;
      workspaces?: string[];
    };
  const manifests = ['package.json'];
  for (const pattern of read('package.json').workspaces ?? []) {
    const found = new Bun.Glob(`${pattern}/package.json`).scanSync(root);
    manifests.push(...[...found].map((path) => path.replaceAll('\\', '/')));
  }
  for (const manifest of manifests.sort()) {
    const directory = posix.dirname(manifest).replace(/^\.$/, '');
    for (const [name, command] of Object.entries(
      read(manifest).scripts ?? {},
    )) {
      sources.push({
        label: `${manifest} script "${name}"`,
        directory,
        command,
      });
    }
  }
  return sources;
}
