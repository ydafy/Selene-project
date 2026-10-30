// Weekly dependency report in Markdown: safe updates, available majors, the
// Expo SDK status and the `bun audit` result. Collectors run the tools and the
// registry calls; every parser and the report builder are pure so tests need
// no network. The report is informational: the CLI exits 0 even when updates
// or findings exist, and 1 only when a collector itself fails.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND_WORKSPACE = '@selene/frontend';
const EXPO_UPGRADE_MIN_AGE_DAYS = 30;
const DAY_MS = 86_400_000;
const GUIDE = 'docs/dependencies.md';

// Majors we chose not to take yet, keyed by package and blocked major. Each reason
// matches a case in docs/dependencies.md, "When not to update"; drop the entry
// when the blocker is gone.
const HELD_BACK: Record<string, { major: number; reason: string }> = {
  typescript: {
    major: 7,
    reason:
      'TypeScript 7.0 has no compiler API until 7.1, and typescript-eslint accepts only <6.1.0',
  },
};

function isHeldBack(row: OutdatedRow): boolean {
  const held = HELD_BACK[row.name];
  return held !== undefined && Number(row.latest.split('.')[0]) >= held.major;
}
const WORKFLOW_PATH = '.github/workflows/dependency-audit.yml';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type OutdatedRow = {
  name: string;
  workspace: string;
  dev: boolean;
  current: string;
  update: string;
  latest: string;
};

export type ExpoMismatch = { name: string; actual: string; expected: string };

export type AuditFinding = {
  name: string;
  id: string;
  severity: string;
  title: string;
  vulnerable: string;
};

export type AuditException = { id: string; name?: string; title?: string };

export type AuditResult = {
  findings: AuditFinding[];
  exceptions: AuditException[];
};

export type ExpoRegistry = { version: string; releasedAt: string };

export type ReportInput = {
  outdated: Result<OutdatedRow[]>;
  expoCheck: Result<ExpoMismatch[]>;
  audit: Result<AuditResult>;
  expo: Result<{ installed: string; latest: ExpoRegistry }>;
  repositories: Result<Record<string, string | undefined>>;
};

export type Collectors = {
  outdated: () => Promise<{ workspace: string; text: string }[]>;
  expoCheck: () => Promise<string>;
  audit: () => Promise<{ json: string; workflow: string }>;
  expoRegistry: () => Promise<string>;
  installedExpo: () => Promise<string>;
  repositories: (
    names: string[],
  ) => Promise<Record<string, string | undefined>>;
};

// ---------------------------------------------------------------- parsers

function cells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function stripStar(value: string): string {
  return value.replace(/\s*\*$/, '');
}

// `bun outdated` has no machine-readable output. It prints a boxed table whose
// header names the columns; a workspace column appears only with --filter.
export function parseOutdated(text: string, workspace: string): OutdatedRow[] {
  const rows: OutdatedRow[] = [];
  let columns: string[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|') || line.startsWith('|-')) continue;
    const row = cells(line);
    if (row[0] === 'Package') {
      columns = row;
    }
    // A changed format must fail the check, not look like "nothing to update".
    const known =
      columns !== undefined &&
      ['Current', 'Update', 'Latest'].every((c) => columns!.includes(c));
    if (!known) {
      throw new Error(`unrecognized \`bun outdated\` output: ${line.trim()}`);
    }
    if (row[0] === 'Package') continue;
    const at = (column: string) =>
      stripStar(row[columns!.indexOf(column)] ?? '');
    const rawName = row[0];
    const dev = rawName.endsWith(' (dev)');
    rows.push({
      name: dev ? rawName.slice(0, -' (dev)'.length) : rawName,
      workspace: columns.includes('Workspace') ? at('Workspace') : workspace,
      dev,
      current: at('Current'),
      update: at('Update'),
      latest: at('Latest'),
    });
  }
  return rows;
}

// `expo install --check --json` prints dotenv preamble lines before the JSON.
export function parseExpoCheck(text: string): ExpoMismatch[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('{'));
  if (start === -1) throw new Error('no JSON in `expo install --check` output');
  const parsed = JSON.parse(lines.slice(start).join('\n')) as {
    dependencies: {
      packageName: string;
      actualVersion: string;
      expectedVersionOrRange: string;
    }[];
  };
  return parsed.dependencies.map((dependency) => ({
    name: dependency.packageName,
    actual: dependency.actualVersion,
    expected: dependency.expectedVersionOrRange,
  }));
}

// The audit job passes accepted exceptions as `--ignore=<id>` flags; reading
// them from the workflow keeps the report on the same list.
export function parseAuditIgnores(workflowText: string): string[] {
  const ids: string[] = [];
  for (const line of workflowText.split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    for (const match of line.matchAll(/--ignore=(\S+)/g)) ids.push(match[1]);
  }
  return ids;
}

type AuditAdvisory = {
  id: number;
  url: string;
  title: string;
  severity: string;
  vulnerable_versions: string;
};

// `bun audit --json` lists every advisory, ignored or below the level, so the
// ignore list and the severity filter are applied here.
export function parseAudit(json: string, ignores: string[]): AuditResult {
  const advisories = JSON.parse(json) as Record<string, AuditAdvisory[]>;
  const findings: AuditFinding[] = [];
  const found = new Map<string, AuditException>();
  for (const [name, list] of Object.entries(advisories)) {
    for (const advisory of list) {
      const id = advisory.url.split('/').pop() ?? String(advisory.id);
      const ignored = ignores.some(
        (ignore) => ignore === id || ignore === String(advisory.id),
      );
      if (ignored) {
        found.set(id, { id, name, title: advisory.title });
        continue;
      }
      if (advisory.severity !== 'high' && advisory.severity !== 'critical') {
        continue;
      }
      findings.push({
        name,
        id,
        severity: advisory.severity,
        title: advisory.title,
        vulnerable: advisory.vulnerable_versions,
      });
    }
  }
  findings.sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  const exceptions = ignores.map((id) => found.get(id) ?? { id });
  return { findings, exceptions };
}

// The SDK release date is the publish time of `<major>.0.0`, not of the latest
// patch, which moves every few days.
export function parseExpoRegistry(json: string): ExpoRegistry {
  const doc = JSON.parse(json) as {
    'dist-tags': { latest: string };
    time: Record<string, string>;
  };
  const version = doc['dist-tags'].latest;
  const releasedAt = doc.time[`${major(version)}.0.0`];
  if (!releasedAt)
    throw new Error(`no publish time for expo ${major(version)}.0.0`);
  return { version, releasedAt };
}

export function changelogUrl(
  name: string,
  repository: string | undefined,
): string {
  const github = repository
    ?.trim()
    .match(
      /^(?:git\+)?(?:https?:\/\/|git:\/\/|ssh:\/\/git@|git@|github:)(?:github\.com[/:])?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/,
    );
  const isGitHub = repository ? /^github:|github\.com/.test(repository) : false;
  return github && isGitHub
    ? `https://github.com/${github[1]}/releases`
    : `https://www.npmjs.com/package/${name}`;
}

// ------------------------------------------------------------------ rules

function major(version: string): number {
  return Number.parseInt(version.split('.')[0], 10);
}

function minor(version: string): number {
  return Number.parseInt(version.split('.')[1] ?? '0', 10);
}

// Below 1.0.0 a minor can break (docs/dependencies.md), so it counts as a major.
function isMajorChange(current: string, latest: string): boolean {
  if (major(latest) !== major(current)) return major(latest) > major(current);
  return major(current) === 0 && minor(latest) > minor(current);
}

export function expoSdkStatus(
  installed: string,
  latest: string,
  releasedAt: string,
  now: Date,
): { kind: 'upgrade' | 'wait' | 'current'; ageDays: number } {
  const ageDays = Math.floor((now.getTime() - Date.parse(releasedAt)) / DAY_MS);
  if (major(latest) <= major(installed)) return { kind: 'current', ageDays };
  return {
    kind: ageDays >= EXPO_UPGRADE_MIN_AGE_DAYS ? 'upgrade' : 'wait',
    ageDays,
  };
}

function isExpoManaged(row: OutdatedRow, mismatches: Set<string>): boolean {
  if (row.workspace !== FRONTEND_WORKSPACE) return false;
  return (
    row.name === 'expo' ||
    row.name === 'react-native' ||
    row.name.startsWith('expo-') ||
    mismatches.has(row.name)
  );
}

// ---------------------------------------------------------------- builder

function byName<T extends { name: string; workspace?: string }>(
  a: T,
  b: T,
): number {
  return (
    a.name.localeCompare(b.name) ||
    (a.workspace ?? '').localeCompare(b.workspace ?? '')
  );
}

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function failed(error: string): string {
  return `Could not check: ${error}`;
}

function describeStatus(status: ReturnType<typeof expoSdkStatus>): string {
  if (status.kind === 'upgrade') {
    return `**Upgrade recommended**: the new SDK is ${status.ageDays} days old (rule: upgrade at ${EXPO_UPGRADE_MIN_AGE_DAYS} days or more). Follow \`odd/tasks/expo-sdk-upgrade.md\`.`;
  }
  if (status.kind === 'wait') {
    return `**New SDK too recent (${status.ageDays} days, wait until ${EXPO_UPGRADE_MIN_AGE_DAYS})**`;
  }
  return '**Up to date**';
}

export function buildDependencyReport(input: ReportInput, now: Date): string {
  const mismatches = input.expoCheck.ok ? input.expoCheck.value : [];
  const mismatchNames = new Set(mismatches.map((item) => item.name));
  const outdated = input.outdated.ok ? input.outdated.value : [];
  const managed = outdated.filter((row) => isExpoManaged(row, mismatchNames));
  const others = outdated.filter((row) => !isExpoManaged(row, mismatchNames));
  const safe = others.filter((row) => row.update !== row.current).sort(byName);
  const allMajors = others
    .filter((row) => isMajorChange(row.current, row.latest))
    .sort(byName);
  const majors = allMajors.filter((row) => !isHeldBack(row));
  const held = [
    ...new Map(
      allMajors
        .filter(isHeldBack)
        .map((row) => [`${row.name}@${row.current}>${row.latest}`, row]),
    ).values(),
  ];
  const findings = input.audit.ok ? input.audit.value.findings : [];

  const parts: string[] = [];
  parts.push(`# Dependency report, ${now.toISOString().slice(0, 10)}`);
  const summary = [
    input.outdated.ok
      ? `${safe.length} safe updates, ${majors.length} majors`
      : 'outdated check failed',
    input.expo.ok
      ? `Expo SDK ${describeStatusShort(input.expo.value, now)}`
      : 'Expo SDK check failed',
    input.expoCheck.ok
      ? `${mismatches.length} packages off the SDK`
      : 'Expo package check failed',
    input.audit.ok ? `${findings.length} vulnerabilities` : 'audit failed',
  ];
  parts.push(`${summary.join(', ')}.`);

  parts.push('## Safe updates (patch and minor)');
  if (!input.outdated.ok) parts.push(failed(input.outdated.error));
  else if (!safe.length) parts.push('Nothing to update.');
  else {
    parts.push(
      table(
        ['Package', 'Workspace', 'Current', 'Update in range'],
        safe.map((row) => [row.name, row.workspace, row.current, row.update]),
      ),
    );
    parts.push(
      'Update them together in one commit. Expo-pinned packages are not listed here: see the Expo section.',
    );
  }

  parts.push('## Majors available');
  if (!input.outdated.ok) parts.push(failed(input.outdated.error));
  else if (!majors.length) parts.push('Nothing to update.');
  else {
    const repositories = input.repositories.ok ? input.repositories.value : {};
    parts.push(
      table(
        ['Package', 'Workspace', 'Current', 'Latest', 'Changelog'],
        majors.map((row) => [
          row.name,
          row.workspace,
          row.current,
          row.latest,
          changelogUrl(row.name, repositories[row.name]),
        ]),
      ),
    );
    parts.push(
      `Update one major per commit and read its changelog first (see \`${GUIDE}\`).`,
    );
    if (!input.repositories.ok) {
      parts.push(
        `Changelog links point to npm. ${failed(input.repositories.error)}`,
      );
    }
  }

  if (held.length) {
    parts.push('## Held back on purpose');
    parts.push(
      table(
        ['Package', 'Current', 'Latest', 'Why not yet'],
        held.map((row) => [
          row.name,
          row.current,
          row.latest,
          HELD_BACK[row.name]!.reason,
        ]),
      ),
    );
    parts.push(
      `See \`${GUIDE}\`, "When not to update". Remove the hold in \`scripts/dependency-report.ts\` when its blocker is gone.`,
    );
  }

  parts.push('## Expo');
  if (!input.expo.ok) parts.push(failed(input.expo.error));
  else {
    const { installed, latest } = input.expo.value;
    const status = expoSdkStatus(
      installed,
      latest.version,
      latest.releasedAt,
      now,
    );
    parts.push(
      [
        `- Installed SDK: ${major(installed)} (expo ${installed})`,
        `- Latest SDK: ${major(latest.version)} (expo ${latest.version}, released ${latest.releasedAt.slice(0, 10)}, ${status.ageDays} days ago)`,
        `- Status: ${describeStatus(status)}`,
      ].join('\n'),
    );
  }
  parts.push('### Packages that do not match the installed SDK');
  if (!input.expoCheck.ok) parts.push(failed(input.expoCheck.error));
  else if (!mismatches.length)
    parts.push('All packages match the installed SDK.');
  else {
    parts.push(
      table(
        ['Package', 'Installed', 'Expected'],
        [...mismatches]
          .sort(byName)
          .map((item) => [item.name, item.actual, item.expected]),
      ),
    );
    parts.push('Update with `npx expo install --fix` from `apps/frontend`.');
  }
  const pending = managed
    .filter((row) => row.update !== row.current)
    .sort(byName);
  if (pending.length) {
    parts.push('### Expo-pinned packages with a newer version in range');
    parts.push(
      table(
        ['Package', 'Current', 'Update in range'],
        pending.map((row) => [row.name, row.current, row.update]),
      ),
    );
    parts.push('Update with `npx expo install --fix` from `apps/frontend`.');
  }

  parts.push('## Security (bun audit)');
  if (!input.audit.ok) parts.push(failed(input.audit.error));
  else {
    if (!findings.length) parts.push('No high or critical vulnerabilities.');
    else {
      parts.push(
        table(
          ['Package', 'Advisory', 'Severity', 'Vulnerable versions', 'Title'],
          findings.map((item) => [
            item.name,
            item.id,
            item.severity,
            item.vulnerable,
            item.title,
          ]),
        ),
      );
    }
    const { exceptions } = input.audit.value;
    if (exceptions.length) {
      parts.push(`Accepted exceptions (\`--ignore\` in \`${WORKFLOW_PATH}\`):`);
      parts.push(
        exceptions
          .map((item) =>
            item.name
              ? `- ${item.id}: ${item.name}, ${item.title}`
              : `- ${item.id}`,
          )
          .join('\n'),
      );
    }
  }

  parts.push(`---\nHow to act on this report: \`${GUIDE}\`.`);
  return `${parts.join('\n\n')}\n`;
}

function describeStatusShort(
  expo: { installed: string; latest: ExpoRegistry },
  now: Date,
): string {
  const status = expoSdkStatus(
    expo.installed,
    expo.latest.version,
    expo.latest.releasedAt,
    now,
  );
  if (status.kind === 'upgrade')
    return `${major(expo.latest.version)} upgrade recommended`;
  if (status.kind === 'wait') return `${major(expo.latest.version)} too recent`;
  return 'up to date';
}

// ------------------------------------------------------------- orchestration

async function settle<T>(
  label: string,
  errors: string[],
  action: () => Promise<T>,
): Promise<Result<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${label}: ${message}`);
    return { ok: false, error: message };
  }
}

export async function runReport(
  collectors: Collectors,
  now: Date,
): Promise<{ markdown: string; exitCode: number; errors: string[] }> {
  const errors: string[] = [];
  const outdated = await settle('bun outdated', errors, async () =>
    (await collectors.outdated()).flatMap(({ workspace, text }) =>
      parseOutdated(text, workspace),
    ),
  );
  const expoCheck = await settle('expo install --check', errors, async () =>
    parseExpoCheck(await collectors.expoCheck()),
  );
  const audit = await settle('bun audit', errors, async () => {
    const { json, workflow } = await collectors.audit();
    return parseAudit(json, parseAuditIgnores(workflow));
  });
  const expo = await settle('expo registry', errors, async () => ({
    installed: await collectors.installedExpo(),
    latest: parseExpoRegistry(await collectors.expoRegistry()),
  }));

  const mismatchNames = new Set(
    expoCheck.ok ? expoCheck.value.map((item) => item.name) : [],
  );
  const majorNames = outdated.ok
    ? [
        ...new Set(
          outdated.value
            .filter(
              (row) =>
                !isExpoManaged(row, mismatchNames) &&
                isMajorChange(row.current, row.latest),
            )
            .map((row) => row.name),
        ),
      ].sort()
    : [];
  const repositories = await settle('npm registry', errors, () =>
    collectors.repositories(majorNames),
  );

  const markdown = buildDependencyReport(
    { outdated, expoCheck, audit, expo, repositories },
    now,
  );
  return { markdown, exitCode: errors.length ? 1 : 0, errors };
}

// -------------------------------------------------------------- collectors

const ROOT = join(import.meta.dir, '..');

async function run(
  cmd: string[],
  cwd: string,
  acceptExitCodes: number[] = [0],
): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (!acceptExitCodes.includes(code)) {
    throw new Error(
      `\`${cmd.join(' ')}\` exited ${code}: ${(stderr || stdout).trim()}`,
    );
  }
  return stdout;
}

async function fetchJson(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

export const realCollectors: Collectors = {
  outdated: async () => [
    {
      workspace: FRONTEND_WORKSPACE,
      text: await run(
        ['bun', 'outdated', '--filter', FRONTEND_WORKSPACE],
        ROOT,
      ),
    },
    {
      workspace: 'admin-web',
      text: await run(['bun', 'outdated', '--filter', 'admin-web'], ROOT),
    },
    { workspace: 'root', text: await run(['bun', 'outdated'], ROOT) },
  ],
  // Exits 1 when packages are off the SDK; the JSON on stdout is still valid.
  expoCheck: () =>
    run(
      ['npx', 'expo', 'install', '--check', '--json'],
      join(ROOT, 'apps', 'frontend'),
      [0, 1],
    ),
  // With --json bun lists every advisory and exits 1 on unignored findings;
  // the report filters them itself.
  audit: async () => {
    const workflow = readFileSync(join(ROOT, WORKFLOW_PATH), {
      encoding: 'utf8',
    });
    const flags = parseAuditIgnores(workflow).map((id) => `--ignore=${id}`);
    const json = await run(
      ['bun', 'audit', '--audit-level=high', '--json', ...flags],
      ROOT,
      [0, 1],
    );
    return { json, workflow };
  },
  expoRegistry: () => fetchJson('https://registry.npmjs.org/expo'),
  installedExpo: async () => {
    const path = join(
      ROOT,
      'apps',
      'frontend',
      'node_modules',
      'expo',
      'package.json',
    );
    try {
      return (
        JSON.parse(readFileSync(path, { encoding: 'utf8' })) as {
          version: string;
        }
      ).version;
    } catch {
      const lock = readFileSync(join(ROOT, 'bun.lock'), { encoding: 'utf8' });
      const match = lock.match(/"expo": \["expo@(\d+\.\d+\.\d+)"/);
      if (!match) throw new Error('installed expo version not found');
      return match[1];
    }
  },
  // A package whose registry entry cannot be read keeps its npm page link.
  repositories: async (names) => {
    const entries = await Promise.all(
      names.map(async (name) => {
        try {
          const doc = JSON.parse(
            await fetchJson(
              `https://registry.npmjs.org/${name.replace('/', '%2f')}/latest`,
            ),
          ) as { repository?: string | { url?: string } };
          const repository =
            typeof doc.repository === 'string'
              ? doc.repository
              : doc.repository?.url;
          return [name, repository] as const;
        } catch {
          return [name, undefined] as const;
        }
      }),
    );
    return Object.fromEntries(entries);
  },
};

if (import.meta.main) {
  const { markdown, exitCode, errors } = await runReport(
    realCollectors,
    new Date(),
  );
  process.stdout.write(markdown);
  for (const error of errors) console.error(error);
  process.exit(exitCode);
}
