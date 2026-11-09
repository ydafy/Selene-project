// Weekly dependency report in Markdown: safe updates, available majors, the
// Expo SDK status, the Node and Bun runtimes, the Supabase CLI, the Stripe API
// version, the GitHub Actions pins, and the `bun audit` result. Collectors run the tools and the
// registry calls; every parser and the report builder are pure so tests need
// no network. The report is informational: the CLI exits 0 even when updates
// or findings exist, and 1 only when a collector itself fails.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseActionUses } from './workflow-actions.ts';

const FRONTEND_WORKSPACE = '@selene/frontend';
const EXPO_UPGRADE_MIN_AGE_DAYS = 30;
// docs/dependencies.md, "Keep Node and Bun current".
const NODE_LTS_MIN_AGE_DAYS = 90;
const NODE_END_WARNING_DAYS = 180;
const BUN_MIN_AGE_DAYS = 3;
// docs/dependencies.md, "Keep GitHub Actions pinned".
const ACTION_MIN_AGE_DAYS = BUN_MIN_AGE_DAYS;
// docs/dependencies.md, "Keep the Supabase CLI and Docker current".
const SUPABASE_CLI_MIN_AGE_DAYS = BUN_MIN_AGE_DAYS;
const SUPABASE_CLI_SECTION = 'Keep the Supabase CLI and Docker current';
// docs/dependencies.md, "Keep the Stripe SDK and API version together".
const STRIPE_SECTION = 'Keep the Stripe SDK and API version together';
const STRIPE_API_VERSION_PATH =
  'supabase/functions/_shared/stripe/api-version.ts';
const STRIPE_SDK_PATH = 'supabase/functions/_shared/stripe/sdk.ts';
const STRIPE_SDK_API_VERSION_PATH = 'node_modules/stripe/esm/apiVersion.js';
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

// The hold reason for a major, or undefined when the major is free to take.
// @types/node is derived: it follows the Node line pinned in .nvmrc, so a major
// above that line is held and the hold lifts when .nvmrc moves up.
function heldReason(
  row: OutdatedRow,
  pinnedNodeMajor: number | undefined,
): string | undefined {
  const latestMajor = Number(row.latest.split('.')[0]);
  if (row.name === '@types/node') {
    return pinnedNodeMajor !== undefined && latestMajor > pinnedNodeMajor
      ? `@types/node follows the pinned Node line (.nvmrc ${pinnedNodeMajor}); take its major together with Node`
      : undefined;
  }
  const held = HELD_BACK[row.name];
  return held !== undefined && latestMajor >= held.major
    ? held.reason
    : undefined;
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

export type NodeRelease = {
  version: string;
  date: string;
  lts: string | false;
  security: boolean;
};

export type NodeLine = { major: number; lts: string | undefined; end: string };

export type BunRelease = { version: string; releasedAt: string };

export type RuntimeStatus = { actions: string[]; notes: string[] };

export type RuntimesInput = {
  pins: { node: string; bun: string };
  releases: NodeRelease[];
  schedule: Map<number, NodeLine>;
  bun: BunRelease;
};

// `pinned` is the `version:` of every supabase/setup-cli step in the workflows.
export type SupabaseCliInput = { pinned: string; latest: BunRelease };

// The source texts the Stripe check reads: the shared api-version.ts, the root
// package.json, and the installed SDK's esm/apiVersion.js and package.json.
export type StripeApiFiles = {
  apiVersion: string;
  packageJson: string;
  sdkApiVersion: string;
  sdkPackageJson: string;
};

// `sent` is the STRIPE_API_VERSION the functions send; `pinned` is the root
// `stripe` devDependency, which is also the installed SDK.
export type StripeApiInput = {
  sent: string;
  pinned: string;
  sdkApiVersion: string;
};

export type ActionRow = {
  action: string;
  pinnedSha: string;
  pinnedTag: string;
  // The commit the pinned tag resolves to today.
  resolvedSha: string;
  latest: { tag: string; publishedAt: string };
};

export type ReportInput = {
  outdated: Result<OutdatedRow[]>;
  expoCheck: Result<ExpoMismatch[]>;
  pins: Result<string[]>;
  audit: Result<AuditResult>;
  expo: Result<{ installed: string; latest: ExpoRegistry }>;
  repositories: Result<Record<string, string | undefined>>;
  runtimes: Result<RuntimesInput>;
  supabaseCli: Result<SupabaseCliInput>;
  stripeApi: Result<StripeApiInput>;
  actions: Result<ActionRow[]>;
};

export type Collectors = {
  outdated: () => Promise<{ workspace: string; text: string }[]>;
  expoCheck: () => Promise<string>;
  expoPins: () => Promise<string>;
  audit: () => Promise<{ json: string; workflow: string }>;
  expoRegistry: () => Promise<string>;
  installedExpo: () => Promise<string>;
  repositories: (
    names: string[],
  ) => Promise<Record<string, string | undefined>>;
  nodeReleases: () => Promise<string>;
  nodeSchedule: () => Promise<string>;
  bunRegistry: () => Promise<string>;
  runtimePins: () => Promise<{ nvmrc: string; packageManager: string }>;
  supabaseCliRegistry: () => Promise<string>;
  stripeApi: () => Promise<StripeApiFiles>;
  // The text of every workflow file.
  workflows: () => Promise<string[]>;
  // A GitHub REST API path such as `repos/<owner>/<repo>/releases/latest`.
  githubApi: (path: string) => Promise<string>;
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

// `bundledNativeModules.json` of the installed `expo` maps each package the SDK
// pins to its version range; only the names matter here.
export function parseExpoPins(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.keys(parsed).length
  ) {
    throw new Error('no pinned packages in bundledNativeModules.json');
  }
  return Object.keys(parsed);
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

// https://nodejs.org/dist/index.json: every release, newest first.
export function parseNodeReleases(json: string): NodeRelease[] {
  const data = JSON.parse(json) as unknown;
  if (!Array.isArray(data)) throw new Error('unrecognized Node release list');
  return (
    data as {
      version: string;
      date: string;
      lts: string | false;
      security: boolean;
    }[]
  ).map((item) => ({
    version: item.version.replace(/^v/, ''),
    date: item.date,
    lts: item.lts,
    security: item.security,
  }));
}

// The nodejs/Release schedule.json, keyed "v24"; pre-1.0 keys ("v0.10") are skipped.
export function parseNodeSchedule(json: string): Map<number, NodeLine> {
  const data = JSON.parse(json) as Record<
    string,
    { lts?: string; end: string }
  >;
  const lines = new Map<number, NodeLine>();
  for (const [key, line] of Object.entries(data)) {
    const match = key.match(/^v(\d+)$/);
    if (!match || match[1] === '0') continue;
    const major = Number(match[1]);
    lines.set(major, { major, lts: line.lts, end: line.end });
  }
  if (!lines.size) throw new Error('unrecognized Node release schedule');
  return new Map([...lines].sort(([a], [b]) => a - b));
}

function parseNpmLatest(json: string, name: string): BunRelease {
  const doc = JSON.parse(json) as {
    'dist-tags'?: { latest?: string };
    time?: Record<string, string>;
  };
  const version = doc['dist-tags']?.latest;
  const releasedAt = version ? doc.time?.[version] : undefined;
  if (!version || !releasedAt) throw new Error(`no latest version for ${name}`);
  return { version, releasedAt };
}

export function parseBunRegistry(json: string): BunRelease {
  return parseNpmLatest(json, 'bun');
}

// The `version:` under each `uses: supabase/setup-cli@...` step. Every step
// must pin the same exact version, so CI and the maintainer's machine agree.
export function parseSupabaseCliPin(workflows: string[]): string {
  const pattern =
    /uses:\s*supabase\/setup-cli@\S+[^\n]*\n\s*with:\s*\n\s*version:\s*['"]?([^\s'"]+)/g;
  const versions = new Set<string>();
  for (const text of workflows) {
    for (const match of text.matchAll(pattern)) versions.add(match[1]);
  }
  if (!versions.size) {
    throw new Error('no supabase/setup-cli step pins a version');
  }
  for (const version of versions) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(
        `supabase/setup-cli version "${version}" is not an exact version`,
      );
    }
  }
  if (versions.size > 1) {
    throw new Error(
      `supabase/setup-cli pins differ: ${[...versions].sort(compareVersions).join(', ')}`,
    );
  }
  return [...versions][0];
}

// The SDK pin and STRIPE_API_VERSION move together, so the installed SDK must be
// the pinned one before its API version says anything about the pin.
export function parseStripeApi(files: StripeApiFiles): StripeApiInput {
  const sent = files.apiVersion.match(
    /export const STRIPE_API_VERSION(?::[^=]+)?=\s*['"]([^'"]+)['"]/,
  )?.[1];
  if (!sent) {
    throw new Error(
      `no STRIPE_API_VERSION literal in ${STRIPE_API_VERSION_PATH}`,
    );
  }
  const pinned = (
    JSON.parse(files.packageJson) as {
      devDependencies?: Record<string, string>;
    }
  ).devDependencies?.stripe;
  if (!pinned) throw new Error('no stripe devDependency in package.json');
  const sdkApiVersion = files.sdkApiVersion.match(
    /export const ApiVersion\s*=\s*['"]([^'"]+)['"]/,
  )?.[1];
  if (!sdkApiVersion) {
    throw new Error(`no ApiVersion in ${STRIPE_SDK_API_VERSION_PATH}`);
  }
  const installed = (JSON.parse(files.sdkPackageJson) as { version?: string })
    .version;
  if (installed !== pinned) {
    throw new Error(
      `installed stripe ${installed} is not the pinned ${pinned}: run \`bun install\``,
    );
  }
  return { sent, pinned, sdkApiVersion };
}

// `releases/latest`: the tag must be a plain vX.Y.Z so it can be compared.
export function parseLatestRelease(json: string): {
  tag: string;
  publishedAt: string;
} {
  const doc = JSON.parse(json) as { tag_name?: string; published_at?: string };
  if (!/^v\d+\.\d+\.\d+$/.test(doc.tag_name ?? '') || !doc.published_at) {
    throw new Error(`unrecognized latest release: ${doc.tag_name}`);
  }
  return { tag: doc.tag_name!, publishedAt: doc.published_at };
}

// `commits/<tag>` resolves annotated tags to the commit they point at.
export function parseCommitSha(json: string): string {
  const sha = (JSON.parse(json) as { sha?: string }).sha;
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('no commit SHA');
  return sha;
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

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return (left[i] ?? 0) - (right[i] ?? 0);
  }
  return 0;
}

function addDays(date: string, days: number): string {
  return new Date(new Date(date).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function daysSince(date: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(date).getTime()) / DAY_MS);
}

// Actions are what the rule asks for now; notes say what comes later.
export function nodeRuntimeStatus(
  pinned: string,
  releases: NodeRelease[],
  schedule: Map<number, NodeLine>,
  now: Date,
): RuntimeStatus & { latestInLine: string; end: string } {
  const pinnedMajor = major(pinned);
  const line = schedule.get(pinnedMajor);
  if (!line) {
    throw new Error(`Node ${pinnedMajor} is not in the release schedule`);
  }
  const newer = releases.filter(
    (item) =>
      major(item.version) === pinnedMajor &&
      compareVersions(item.version, pinned) > 0,
  );
  const latestInLine = newer.reduce(
    (best, item) =>
      compareVersions(item.version, best) > 0 ? item.version : best,
    pinned,
  );
  const actions: string[] = [];
  const notes: string[] = [];
  if (latestInLine !== pinned) {
    const security = newer.some((item) => item.security);
    actions.push(
      `Update to ${latestInLine}${security ? ' (security release)' : ''}`,
    );
  }
  const daysLeft = -daysSince(line.end, now);
  if (daysLeft < 0) {
    actions.push(
      `Node ${pinnedMajor} is no longer supported (ended ${line.end})`,
    );
  } else if (daysLeft <= NODE_END_WARNING_DAYS) {
    actions.push(`Node ${pinnedMajor} support ends ${line.end}`);
  }
  const newerLts = [...schedule.values()].filter(
    (item): item is NodeLine & { lts: string } =>
      item.major > pinnedMajor &&
      item.lts !== undefined &&
      daysSince(item.lts, now) >= 0,
  );
  const ready = newerLts
    .filter((item) => daysSince(item.lts, now) >= NODE_LTS_MIN_AGE_DAYS)
    .at(-1);
  if (ready)
    actions.push(`Move to Node ${ready.major} (LTS since ${ready.lts})`);
  const upcoming = newerLts.at(-1);
  if (upcoming && upcoming !== ready) {
    notes.push(
      `Node ${upcoming.major} is LTS since ${upcoming.lts}: move to it after ${addDays(upcoming.lts, NODE_LTS_MIN_AGE_DAYS)}`,
    );
  }
  return { latestInLine, end: line.end, actions, notes };
}

export function bunRuntimeStatus(
  pinned: string,
  latest: BunRelease,
  now: Date,
): RuntimeStatus {
  if (compareVersions(latest.version, pinned) <= 0) {
    return { actions: [], notes: [] };
  }
  const age = daysSince(latest.releasedAt, now);
  if (age < BUN_MIN_AGE_DAYS) {
    return {
      actions: [],
      notes: [
        `Bun ${latest.version} is ${age} days old: update after ${addDays(latest.releasedAt, BUN_MIN_AGE_DAYS)}`,
      ],
    };
  }
  return { actions: [`Update to ${latest.version}`], notes: [] };
}

export function supabaseCliStatus(
  pinned: string,
  latest: BunRelease,
  now: Date,
): RuntimeStatus {
  if (compareVersions(latest.version, pinned) <= 0) {
    return { actions: [], notes: [] };
  }
  const age = daysSince(latest.releasedAt, now);
  if (age < SUPABASE_CLI_MIN_AGE_DAYS) {
    return {
      actions: [],
      notes: [
        `Supabase CLI ${latest.version} is ${age} days old: update after ${addDays(latest.releasedAt, SUPABASE_CLI_MIN_AGE_DAYS)}`,
      ],
    };
  }
  const isMajor = major(latest.version) > major(pinned);
  return {
    actions: [
      `Update to ${latest.version}${isMajor ? ' (major: read the release notes and the migration guide)' : ''}`,
    ],
    notes: [],
  };
}

export function stripeApiStatus(input: StripeApiInput): RuntimeStatus {
  if (input.sent === input.sdkApiVersion) return { actions: [], notes: [] };
  return {
    actions: [
      `Mismatch: the functions send ${input.sent}, stripe ${input.pinned} ships ${input.sdkApiVersion}. Bump the SDK pin and STRIPE_API_VERSION together in one change`,
    ],
    notes: [],
  };
}

// A pin that does not match its tag comment is an action; so is a release at
// least ACTION_MIN_AGE_DAYS old. A younger one only gets a note.
export function actionStatus(row: ActionRow, now: Date): RuntimeStatus {
  const actions: string[] = [];
  const notes: string[] = [];
  if (row.pinnedSha !== row.resolvedSha) {
    actions.push(
      `Pinned SHA is not ${row.pinnedTag} (resolves to ${row.resolvedSha.slice(0, 7)})`,
    );
  }
  const pinned = row.pinnedTag.slice(1);
  const latest = row.latest.tag.slice(1);
  if (compareVersions(latest, pinned) > 0) {
    const age = daysSince(row.latest.publishedAt, now);
    if (age < ACTION_MIN_AGE_DAYS) {
      notes.push(
        `${row.latest.tag} is ${age} days old: update after ${addDays(row.latest.publishedAt, ACTION_MIN_AGE_DAYS)}`,
      );
    } else {
      actions.push(
        `Update to ${row.latest.tag}${major(latest) > major(pinned) ? ' (major: read the release notes)' : ''}`,
      );
    }
  }
  return { actions, notes };
}

function describeRuntime(status: RuntimeStatus): string {
  const parts = [...status.actions, ...status.notes];
  return parts.length ? parts.join('. ') : 'Up to date';
}

function isExpoManaged(
  row: OutdatedRow,
  mismatches: Set<string>,
  pins: Set<string>,
): boolean {
  if (row.workspace !== FRONTEND_WORKSPACE) return false;
  return (
    row.name === 'expo' ||
    row.name === 'react-native' ||
    row.name.startsWith('expo-') ||
    mismatches.has(row.name) ||
    pins.has(row.name)
  );
}

// Without the pin list an app package may or may not be pinned, so it is
// neither Expo-managed nor safe to list for a one-by-one update.
function isUnclassified(
  row: OutdatedRow,
  mismatches: Set<string>,
  pins: Set<string>,
  pinsKnown: boolean,
): boolean {
  return (
    !pinsKnown &&
    row.workspace === FRONTEND_WORKSPACE &&
    !isExpoManaged(row, mismatches, pins)
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
  const pins = new Set(input.pins.ok ? input.pins.value : []);
  const managed = outdated.filter((row) =>
    isExpoManaged(row, mismatchNames, pins),
  );
  const unclassified = outdated.filter((row) =>
    isUnclassified(row, mismatchNames, pins, input.pins.ok),
  );
  const others = outdated.filter(
    (row) =>
      !isExpoManaged(row, mismatchNames, pins) &&
      !isUnclassified(row, mismatchNames, pins, input.pins.ok),
  );
  const safe = others.filter((row) => row.update !== row.current).sort(byName);
  const allMajors = others
    .filter((row) => isMajorChange(row.current, row.latest))
    .sort(byName);
  const pinnedNodeMajor = input.runtimes.ok
    ? Number(input.runtimes.value.pins.node.split('.')[0])
    : undefined;
  const isHeldBack = (row: OutdatedRow) =>
    heldReason(row, pinnedNodeMajor) !== undefined;
  const majors = allMajors.filter((row) => !isHeldBack(row));
  const held = [
    ...new Map(
      allMajors
        .filter(isHeldBack)
        .map((row) => [`${row.name}@${row.current}>${row.latest}`, row]),
    ).values(),
  ];
  const findings = input.audit.ok ? input.audit.value.findings : [];
  const runtimes = input.runtimes.ok
    ? runtimeRows(input.runtimes.value, now)
    : undefined;
  const runtimeUpdates = runtimes
    ? runtimes.filter((row) => row.status.actions.length).length
    : 0;

  const cliStatus = input.supabaseCli.ok
    ? supabaseCliStatus(
        input.supabaseCli.value.pinned,
        input.supabaseCli.value.latest,
        now,
      )
    : undefined;

  const stripeStatus = input.stripeApi.ok
    ? stripeApiStatus(input.stripeApi.value)
    : undefined;

  const actions = input.actions.ok ? input.actions.value : undefined;
  const actionUpdates = actions
    ? actions.filter((row) => actionStatus(row, now).actions.length).length
    : 0;

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
    !runtimes
      ? 'runtime check failed'
      : runtimeUpdates
        ? `${runtimeUpdates} runtime update${runtimeUpdates === 1 ? '' : 's'}`
        : 'runtimes up to date',
    !cliStatus
      ? 'Supabase CLI check failed'
      : cliStatus.actions.length
        ? 'Supabase CLI update'
        : 'Supabase CLI up to date',
    !stripeStatus
      ? 'Stripe API check failed'
      : stripeStatus.actions.length
        ? 'Stripe API version mismatch'
        : 'Stripe API version matches the SDK',
    !actions
      ? 'actions check failed'
      : actionUpdates
        ? `${actionUpdates} action update${actionUpdates === 1 ? '' : 's'}`
        : 'actions up to date',
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
  if (input.outdated.ok && !input.pins.ok) {
    parts.push(
      `${failed(input.pins.error)}. ${unclassified.length} app packages (\`${FRONTEND_WORKSPACE}\`) could not be classified as Expo-pinned or not, so they are not listed as majors or safe updates.`,
    );
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
          heldReason(row, pinnedNodeMajor)!,
        ]),
      ),
    );
    parts.push(
      `See \`${GUIDE}\`, "When not to update". Remove the hold in \`scripts/ci/dependency-report.ts\` when its blocker is gone.`,
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
  const newerMajor = managed
    .filter(
      (row) =>
        row.name !== 'expo' &&
        row.name !== 'react-native' &&
        !row.name.startsWith('expo-') &&
        isMajorChange(row.current, row.latest),
    )
    .sort(byName);
  if (newerMajor.length) {
    parts.push('### Expo-pinned packages with a newer major');
    parts.push(
      table(
        ['Package', 'Current', 'Latest'],
        newerMajor.map((row) => [row.name, row.current, row.latest]),
      ),
    );
    parts.push(
      'These move with the next Expo SDK upgrade, not one by one: the SDK pins their version. Follow the SDK procedure (`npx expo install --fix` from `apps/frontend`).',
    );
  }

  parts.push('## Runtimes');
  if (!input.runtimes.ok) parts.push(failed(input.runtimes.error));
  else {
    parts.push(
      table(
        ['Runtime', 'Pinned', 'Latest', 'Support ends', 'Status'],
        runtimes!.map((row) => [
          row.name,
          row.pinned,
          row.latest,
          row.end,
          describeRuntime(row.status),
        ]),
      ),
    );
    parts.push(
      `Node: latest release of the pinned line, from \`.nvmrc\`. Bun: latest release, from \`packageManager\`. Change both sources and every \`apps/frontend/eas.json\` profile together (see \`${GUIDE}\`, "Keep Node and Bun current").`,
    );
  }

  parts.push('## Supabase CLI');
  if (!input.supabaseCli.ok) parts.push(failed(input.supabaseCli.error));
  else {
    const { pinned, latest } = input.supabaseCli.value;
    parts.push(
      table(
        ['Pinned', 'Latest', 'Release notes', 'Status'],
        [
          [
            pinned,
            latest.version,
            `https://github.com/supabase/cli/releases/tag/v${latest.version}`,
            describeRuntime(cliStatus!),
          ],
        ],
      ),
    );
    parts.push(
      `Pinned: the \`version:\` of \`supabase/setup-cli\` in \`.github/workflows/ci.yml\`. Update it and the CLI on your machine together. Docker Desktop is not checked here: update it by hand every month (see \`${GUIDE}\`, "${SUPABASE_CLI_SECTION}").`,
    );
  }

  parts.push('## Stripe API version');
  if (!input.stripeApi.ok) parts.push(failed(input.stripeApi.error));
  else {
    const { sent, pinned, sdkApiVersion } = input.stripeApi.value;
    parts.push(
      table(
        ['STRIPE_API_VERSION', 'SDK pin', 'SDK API version', 'Status'],
        [
          [
            sent,
            `stripe ${pinned}`,
            sdkApiVersion,
            stripeStatus!.actions.length
              ? stripeStatus!.actions.join('. ')
              : 'Matches the SDK',
          ],
        ],
      ),
    );
    parts.push(
      `The functions send \`STRIPE_API_VERSION\` from \`${STRIPE_API_VERSION_PATH}\`. The SDK pin is the root \`stripe\` devDependency, which only \`${STRIPE_SDK_PATH}\` imports. Move both in one change (see \`${GUIDE}\`, "${STRIPE_SECTION}").`,
    );
  }

  parts.push('## GitHub Actions');
  if (!input.actions.ok) parts.push(failed(input.actions.error));
  else {
    parts.push(
      table(
        ['Action', 'Pinned', 'Latest', 'Status'],
        actions!.map((row) => [
          row.action,
          row.pinnedTag,
          row.latest.tag,
          describeRuntime(actionStatus(row, now)),
        ]),
      ),
    );
    parts.push(
      `Update with the steps in \`${GUIDE}\`, "Keep GitHub Actions pinned".`,
    );
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

function runtimeRows(input: RuntimesInput, now: Date) {
  const node = nodeRuntimeStatus(
    input.pins.node,
    input.releases,
    input.schedule,
    now,
  );
  return [
    {
      name: 'Node',
      pinned: input.pins.node,
      latest: node.latestInLine,
      end: node.end,
      status: node,
    },
    {
      name: 'Bun',
      pinned: input.pins.bun,
      latest: input.bun.version,
      end: '-',
      status: bunRuntimeStatus(input.pins.bun, input.bun, now),
    },
  ];
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
  const pins = await settle('expo pins', errors, async () =>
    parseExpoPins(await collectors.expoPins()),
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
  const pinNames = new Set(pins.ok ? pins.value : []);
  const majorNames = outdated.ok
    ? [
        ...new Set(
          outdated.value
            .filter(
              (row) =>
                !isExpoManaged(row, mismatchNames, pinNames) &&
                !isUnclassified(row, mismatchNames, pinNames, pins.ok) &&
                isMajorChange(row.current, row.latest),
            )
            .map((row) => row.name),
        ),
      ].sort()
    : [];
  const repositories = await settle('npm registry', errors, () =>
    collectors.repositories(majorNames),
  );

  const runtimes = await settle('runtimes', errors, async () => {
    const [releases, schedule, bun, files] = await Promise.all([
      collectors.nodeReleases(),
      collectors.nodeSchedule(),
      collectors.bunRegistry(),
      collectors.runtimePins(),
    ]);
    const value: RuntimesInput = {
      pins: {
        node: files.nvmrc.trim(),
        bun: files.packageManager.replace(/^bun@/, ''),
      },
      releases: parseNodeReleases(releases),
      schedule: parseNodeSchedule(schedule),
      bun: parseBunRegistry(bun),
    };
    // Fails here, not in the builder, when the pinned line is unknown.
    runtimeRows(value, now);
    return value;
  });

  const supabaseCli = await settle('supabase cli', errors, async () => {
    const [workflows, registry] = await Promise.all([
      collectors.workflows(),
      collectors.supabaseCliRegistry(),
    ]);
    return {
      pinned: parseSupabaseCliPin(workflows),
      latest: parseNpmLatest(registry, 'supabase'),
    };
  });

  const stripeApi = await settle('stripe api version', errors, async () =>
    parseStripeApi(await collectors.stripeApi()),
  );

  const actions = await settle('github actions', errors, async () => {
    const pinned = new Map<string, { ref: string; tag: string }>();
    for (const text of await collectors.workflows()) {
      for (const use of parseActionUses(text)) {
        if (!use.tag) {
          throw new Error(`${use.action} has no release tag comment`);
        }
        pinned.set(use.action, { ref: use.ref, tag: use.tag });
      }
    }
    return Promise.all(
      [...pinned].sort().map(async ([action, pin]) => ({
        action,
        pinnedSha: pin.ref,
        pinnedTag: pin.tag,
        resolvedSha: parseCommitSha(
          await collectors.githubApi(
            `repos/${action}/commits/${encodeURIComponent(pin.tag)}`,
          ),
        ),
        latest: parseLatestRelease(
          await collectors.githubApi(`repos/${action}/releases/latest`),
        ),
      })),
    );
  });

  const markdown = buildDependencyReport(
    {
      outdated,
      expoCheck,
      pins,
      audit,
      expo,
      repositories,
      runtimes,
      supabaseCli,
      stripeApi,
      actions,
    },
    now,
  );
  return { markdown, exitCode: errors.length ? 1 : 0, errors };
}

// -------------------------------------------------------------- collectors

const ROOT = join(import.meta.dir, '..', '..');

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

// GH_TOKEN raises the API rate limit; the weekly workflow sets it.
async function githubApi(path: string): Promise<string> {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const url = `https://api.github.com/${path}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
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
  expoPins: () =>
    Promise.resolve(
      readFileSync(
        join(
          ROOT,
          'apps',
          'frontend',
          'node_modules',
          'expo',
          'bundledNativeModules.json',
        ),
        { encoding: 'utf8' },
      ),
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
  nodeReleases: () => fetchJson('https://nodejs.org/dist/index.json'),
  nodeSchedule: () =>
    fetchJson(
      'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json',
    ),
  bunRegistry: () => fetchJson('https://registry.npmjs.org/bun'),
  supabaseCliRegistry: () => fetchJson('https://registry.npmjs.org/supabase'),
  githubApi,
  // bun install puts the pinned SDK in node_modules; the weekly workflow runs it first.
  stripeApi: () => {
    const read = (path: string) =>
      readFileSync(join(ROOT, path), { encoding: 'utf8' });
    return Promise.resolve({
      apiVersion: read(STRIPE_API_VERSION_PATH),
      packageJson: read('package.json'),
      sdkApiVersion: read(STRIPE_SDK_API_VERSION_PATH),
      sdkPackageJson: read('node_modules/stripe/package.json'),
    });
  },
  workflows: () => {
    const dir = join(ROOT, '.github', 'workflows');
    return Promise.resolve(
      readdirSync(dir)
        .filter((file) => /\.ya?ml$/.test(file))
        .map((file) => readFileSync(join(dir, file), { encoding: 'utf8' })),
    );
  },
  runtimePins: () =>
    Promise.resolve({
      nvmrc: readFileSync(join(ROOT, '.nvmrc'), { encoding: 'utf8' }),
      packageManager: (
        JSON.parse(
          readFileSync(join(ROOT, 'package.json'), { encoding: 'utf8' }),
        ) as { packageManager: string }
      ).packageManager,
    }),
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
