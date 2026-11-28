// Collects the data of the weekly routine (docs/maintenance.md) and prints a short
// summary, so the agent reads one report instead of many raw outputs. It only
// reads: it never starts a workflow, edits an issue, or writes a file. It decides
// only what a command can compute; judging the data stays with the agent and the
// maintainer. A failed command prints "Could not check" in its section, the other
// checks still run, and the script exits 1.

import type { AdvisorFinding } from '../ci/check-security-advisors';
import { ACCEPTED_SECURITY_FINDINGS } from '../ci/security-advisor-exceptions';
import {
  ACCEPTED_REMOTE_FINDINGS,
  type AcceptedAdvisorLint,
} from './routine-accepted-findings';

export type Runner = (cmd: string[]) => Promise<string>;

export type RoutineDates = {
  today: string;
  since: string;
  stale: string;
  untaken: string;
  sunday: string;
  isoWeek: number;
  topic: string;
};

export type Section = { lines: string[]; failed: boolean };

const USAGE =
  'Usage: bun run routine:collect\nPrints the weekly routine data of docs/maintenance.md. It only reads.';
const DAY_MS = 24 * 60 * 60 * 1000;
// docs/maintenance.md, "Pick the topic of the week": ISO week modulo 8.
const TOPICS = [
  'payments',
  'orders',
  'mobile',
  'admin-web',
  'edge-functions',
  'database',
  'tooling',
  'docs',
];
const ISSUE_LIMIT = 1000;
const LIST_LIMIT = 200;
const LIMIT_REACHED = `the list reached its limit of ${LIST_LIMIT}; raise --limit.`;

// ---------------------------------------------------------------- dates

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoWeek(day: Date): number {
  const thursday = new Date(day);
  thursday.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.ceil(((thursday.getTime() - yearStart) / DAY_MS + 1) / 7);
}

// Dates in UTC, the time zone of GitHub search and of the dependency crons.
export function routineDates(now: Date): RoutineDates {
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const before = (days: number) =>
    isoDate(new Date(day.getTime() - days * DAY_MS));
  const week = isoWeek(day);
  return {
    today: isoDate(day),
    since: before(7),
    stale: before(60),
    untaken: before(14),
    sunday: before(day.getUTCDay()),
    isoWeek: week,
    topic: TOPICS[week % TOPICS.length],
  };
}

// ---------------------------------------------------------------- output parsing

type Json = Record<string, unknown>;

function jsonValue(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonList(value: unknown): Json[] {
  if (!Array.isArray(value) || !value.every(isJson))
    throw new Error('the output is not a JSON list of objects');
  return value;
}

function text(item: Json, key: string): string {
  const value = item[key];
  if (typeof value !== 'string')
    throw new Error(`the output has no text field "${key}"`);
  return value;
}

function count(item: Json, key: string): number {
  const value = item[key];
  if (typeof value !== 'number')
    throw new Error(`the output has no number field "${key}"`);
  return value;
}

type Run = { id: number; createdAt: string; status: string; event: string };
type Job = { name: string; conclusion: string };
type Issue = {
  number: number;
  title: string;
  labels: string[];
  milestone: string | undefined;
  createdAt: string;
  updatedAt: string;
};

function parseRuns(output: string): Run[] {
  return jsonList(jsonValue(output)).map((run) => ({
    id: count(run, 'databaseId'),
    createdAt: text(run, 'createdAt'),
    status: text(run, 'status'),
    event: text(run, 'event'),
  }));
}

function parseJobs(output: string): Job[] {
  const value = jsonValue(output);
  if (!isJson(value)) throw new Error('the output is not a JSON object');
  return jsonList(value.jobs).map((job) => ({
    name: text(job, 'name'),
    // An unfinished job has an empty conclusion.
    conclusion: typeof job.conclusion === 'string' ? job.conclusion : '',
  }));
}

function parseIssues(output: string): Issue[] {
  return jsonList(jsonValue(output)).map((issue) => {
    const milestone = issue.milestone;
    return {
      number: count(issue, 'number'),
      title: text(issue, 'title'),
      labels: jsonList(issue.labels ?? []).map((label) => text(label, 'name')),
      milestone: isJson(milestone) ? text(milestone, 'title') : undefined,
      createdAt: typeof issue.createdAt === 'string' ? issue.createdAt : '',
      updatedAt: typeof issue.updatedAt === 'string' ? issue.updatedAt : '',
    };
  });
}

// ---------------------------------------------------------------- sections

function shown(cmd: string[]): string {
  return cmd.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Collects one section's lines. A command that fails, or whose output does not
// parse, adds a "Could not check" line where its data would go.
class SectionBuilder {
  readonly lines: string[] = [];
  failed = false;

  constructor(private readonly run: Runner) {}

  async read<T>(
    cmd: string[],
    parse: (output: string) => T,
  ): Promise<T | undefined> {
    try {
      return parse(await this.run(cmd));
    } catch (error) {
      this.lines.push(`Could not check: ${shown(cmd)}: ${message(error)}`);
      this.failed = true;
      return undefined;
    }
  }

  list(title: string, items: string[]): void {
    if (items.length === 0) this.lines.push(`${title}: none.`);
    else
      this.lines.push(
        `${title} (${items.length}):`,
        ...items.map((item) => `- ${item}`),
      );
  }

  done(): Section {
    return { lines: this.lines, failed: this.failed };
  }
}

const DEPENDENCY_WORKFLOWS = [
  {
    file: 'dependency-audit.yml',
    job: 'audit',
    onFailure: 'Needs a decision.',
  },
  {
    file: 'dependency-report.yml',
    job: 'report',
    onFailure:
      'Rerun the report (docs/maintenance.md, "A. Dependencies", step 1).',
    // A pending manual run is already the rerun. A pending scheduled backup run
    // is not: it skips the report job when another scheduled run started in the
    // last 24 hours (scripts/ci/scheduled-backup.ts).
    rerunEvent: 'workflow_dispatch',
  },
];
const REPORT_ISSUE_TITLE = 'Reporte de dependencias';
const REPORT_AUTHOR = 'app/github-actions';
// Only the issue the report workflow created: anyone can open one with the same
// title (.github/workflows/dependency-report.yml).
const REPORT_ISSUES = [
  'gh',
  'issue',
  'list',
  '--author',
  REPORT_AUTHOR,
  '--search',
  'Reporte de dependencias in:title',
  '--state',
  'open',
  '--json',
  'number,title,body',
];
const REPORT_TITLE = /^# Dependency report, (\d{4}-\d{2}-\d{2})\s*$/;

// docs/maintenance.md, "A. Dependencies". A run counts only when it ran on main
// and its work job ran: a backup run that found an earlier run skips that job
// and still succeeds, and a run on a feature branch is a test.
export async function collectDependencies(
  run: Runner,
  dates: RoutineDates,
): Promise<Section> {
  const section = new SectionBuilder(run);
  const sundayStart = `${dates.sunday}T00:00:00Z`;

  for (const workflow of DEPENDENCY_WORKFLOWS) {
    const runs: Run[] = [];
    let readAll = true;
    for (const event of ['schedule', 'workflow_dispatch']) {
      const listed = await section.read(
        [
          'gh',
          'run',
          'list',
          '--workflow',
          workflow.file,
          '--branch',
          'main',
          '--event',
          event,
          '--created',
          `>=${dates.sunday}`,
          '--limit',
          String(LIST_LIMIT),
          '--json',
          'databaseId,createdAt,status,event',
        ],
        capped(LIST_LIMIT, LIMIT_REACHED, parseRuns),
      );
      if (!listed) {
        readAll = false;
        break;
      }
      runs.push(...listed);
    }
    if (!readAll) continue;

    const recent = runs
      .filter((item) => item.createdAt >= sundayStart)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const pending = recent.filter((item) => item.status !== 'completed');
    for (const item of pending)
      section.lines.push(
        `${workflow.file}: run ${item.id} (${item.event}) is ${item.status}. Wait for it.`,
      );

    let latest: { run: Run; conclusion: string } | undefined;
    let readJobs = true;
    for (const item of recent.filter((r) => r.status === 'completed')) {
      const jobs = await section.read(
        ['gh', 'run', 'view', String(item.id), '--json', 'jobs'],
        parseJobs,
      );
      if (!jobs) {
        readJobs = false;
        break;
      }
      const job = jobs.find((candidate) => candidate.name === workflow.job);
      if (job && job.conclusion !== '' && job.conclusion !== 'skipped') {
        latest = { run: item, conclusion: job.conclusion };
        break;
      }
    }
    if (!readJobs) continue;

    if (latest) {
      const { run: item, conclusion } = latest;
      const next =
        conclusion === 'success' ||
        pending.some((item) => item.event === workflow.rerunEvent)
          ? ''
          : ` ${workflow.onFailure}`;
      section.lines.push(
        `${workflow.file}: the ${workflow.job} job ran in run ${item.id} (${item.event}, ${item.createdAt}): ${conclusion}.${next}`,
      );
    } else if (pending.length === 0) {
      section.lines.push(
        `${workflow.file}: no run since ${dates.sunday} ran the ${workflow.job} job. Start it (docs/dependencies.md).`,
      );
    }
  }

  const reports = await section.read(REPORT_ISSUES, (output) =>
    jsonList(jsonValue(output))
      .filter((issue) => text(issue, 'title') === REPORT_ISSUE_TITLE)
      .map((issue) => ({
        number: count(issue, 'number'),
        body: text(issue, 'body'),
      })),
  );
  if (reports?.length === 0)
    section.lines.push(
      `No open "${REPORT_ISSUE_TITLE}" issue by ${REPORT_AUTHOR}.`,
    );
  for (const report of reports ?? []) {
    const lines = report.body.split(/\r?\n/);
    const titleAt = lines.findIndex((line) => REPORT_TITLE.test(line));
    if (titleAt < 0) {
      section.lines.push(
        `Report issue #${report.number}: its body has no "# Dependency report, <date>" line.`,
      );
      continue;
    }
    const date = REPORT_TITLE.exec(lines[titleAt])?.[1] ?? '';
    const summary =
      lines.slice(titleAt + 1).find((line) => line.trim() !== '') ??
      '(no summary line)';
    const old = date < dates.sunday ? `, before ${dates.sunday}` : '';
    section.lines.push(
      `Report issue #${report.number} (report of ${date}${old}): ${summary.trim()}`,
    );
  }
  return section.done();
}

const OPEN_ISSUES = [
  'gh',
  'issue',
  'list',
  '--state',
  'open',
  '--limit',
  String(ISSUE_LIMIT),
  '--json',
  'number,title,labels,milestone,createdAt,updatedAt',
];
const OPEN_PRS = [
  'gh',
  'pr',
  'list',
  '--state',
  'open',
  '--limit',
  String(LIST_LIMIT),
  '--json',
  'number,title,createdAt,isDraft',
];
// A title that names an issue type, as `[Finding] ...` or `Idea: ...` do.
const TYPED_TITLE = /^\[?(finding|idea)\b/i;

function byNumber<T extends { number: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.number - b.number);
}

function describeLabels(issue: Issue): string {
  const labels =
    issue.labels.length > 0 ? issue.labels.join(', ') : 'no labels';
  return issue.milestone ? `${labels}; milestone ${issue.milestone}` : labels;
}

// docs/maintenance.md, "C. Backlog". One list of open issues answers every
// open-issue question, so the counts agree with each other.
export async function collectBacklog(
  run: Runner,
  dates: RoutineDates,
): Promise<Section> {
  const section = new SectionBuilder(run);
  const sinceStart = `${dates.since}T00:00:00Z`;
  const staleStart = `${dates.stale}T00:00:00Z`;

  const open = await section.read(OPEN_ISSUES, (output) => {
    const parsed = parseIssues(output);
    if (parsed.length >= ISSUE_LIMIT)
      throw new Error(
        `the list reached its limit of ${ISSUE_LIMIT}; raise --limit.`,
      );
    return byNumber(parsed);
  });
  const prs = await section.read(
    OPEN_PRS,
    capped(LIST_LIMIT, LIMIT_REACHED, (output) =>
      byNumber(
        jsonList(jsonValue(output)).map((pr) => ({
          number: count(pr, 'number'),
          title: text(pr, 'title'),
          createdAt: text(pr, 'createdAt'),
          isDraft: pr.isDraft === true,
        })),
      ),
    ),
  );
  const closedGoLive = await section.read(
    [
      'gh',
      'issue',
      'list',
      '--state',
      'closed',
      '--milestone',
      'Go-live',
      '--search',
      `closed:>=${dates.since}`,
      '--limit',
      String(LIST_LIMIT),
      '--json',
      'number,title,createdAt',
    ],
    capped(LIST_LIMIT, LIMIT_REACHED, (output) =>
      jsonList(jsonValue(output)).map((issue) => text(issue, 'createdAt')),
    ),
  );

  const counts = [
    open ? `Open issues: ${open.length}.` : '',
    prs ? `Open PRs: ${prs.length}.` : '',
  ].filter(Boolean);
  if (counts.length > 0) section.lines.push(counts.join(' '));

  if (open) {
    section.list(
      `New since ${dates.since}`,
      open
        .filter((issue) => issue.createdAt >= sinceStart)
        .map(
          (issue) =>
            `#${issue.number} ${issue.title} (${describeLabels(issue)})`,
        ),
    );
  }

  // Only the count and its change: listing every launch blocker each week is
  // noise (53 on 2026-11-28). An issue created and closed this week is in the
  // closed list only, so "created" needs both lists.
  const goLive = open?.filter((issue) => issue.milestone === 'Go-live');
  if (goLive && closedGoLive) {
    const created = [
      ...goLive.map((issue) => issue.createdAt),
      ...closedGoLive,
    ].filter((createdAt) => createdAt >= sinceStart).length;
    section.lines.push(
      `Go-live: ${goLive.length} open (${created} created since ${dates.since}), ${closedGoLive.length} closed since ${dates.since}.`,
    );
  } else if (goLive)
    section.lines.push(
      `Go-live: ${goLive.length} open; created and closed since ${dates.since} not checked.`,
    );
  else if (closedGoLive)
    section.lines.push(
      `Go-live: ${closedGoLive.length} closed since ${dates.since}.`,
    );

  if (open) {
    const has = (issue: Issue, label: string) => issue.labels.includes(label);
    for (const [title, label] of [
      ['Critical', 'priority:critical'],
      ['High', 'priority:high'],
    ])
      section.list(
        title,
        open
          .filter((issue) => has(issue, label))
          .map((issue) => `#${issue.number} ${issue.title}`),
      );

    section.list(
      'Findings without a priority',
      open
        .filter(
          (issue) =>
            has(issue, 'finding') &&
            !issue.labels.some((label) => label.startsWith('priority:')),
        )
        .map((issue) => `#${issue.number} ${issue.title}`),
    );

    section.list(
      'Titles that name a type its labels lack',
      open.flatMap((issue) => {
        const type = TYPED_TITLE.exec(issue.title)?.[1]?.toLowerCase();
        return type && !has(issue, type)
          ? [`#${issue.number} ${issue.title}: no ${type} label`]
          : [];
      }),
    );

    section.list(
      `Stale, not updated since ${dates.stale}`,
      open
        .filter((issue) => issue.updatedAt < staleStart)
        .map(
          (issue) =>
            `#${issue.number} ${issue.title} (updated ${issue.updatedAt.slice(0, 10)})`,
        ),
    );
  }

  if (prs)
    section.list(
      'PRs open more than 7 days',
      prs
        .filter((pr) => pr.createdAt < sinceStart)
        .map(
          (pr) =>
            `#${pr.number} ${pr.title} (opened ${pr.createdAt.slice(0, 10)}${pr.isDraft ? ', draft' : ''})`,
        ),
    );
  return section.done();
}

const REPO_API = 'repos/ydafy/Selene-project';
// `gh api` without --paginate returns one page of up to 30 items.
const API_PAGE = 30;
const PAGE_REACHED = `the list reached GitHub's page size of ${API_PAGE}; add --paginate.`;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// Whole UTC days from a timestamp to a date.
function daysBetween(from: string, to: string): number {
  const time = Date.parse(from);
  if (Number.isNaN(time)) throw new Error(`${from} is not a date`);
  return Math.round(
    (Date.parse(to) - Date.parse(isoDate(new Date(time)))) / DAY_MS,
  );
}

// Fails closed: a list as long as its limit may have been cut.
function capped<T>(
  limit: number,
  reached: string,
  parse: (output: string) => T[],
): (output: string) => T[] {
  return (output) => {
    const items = parse(output);
    if (items.length >= limit) throw new Error(reached);
    return items;
  };
}

// The accepted remote lints, and the local CI list that also accepts a security
// finding by its cacheKey.
export type AcceptedLists = {
  remote: AcceptedAdvisorLint[];
  ci: Record<string, string>;
};
const ACCEPTED: AcceptedLists = {
  remote: ACCEPTED_REMOTE_FINDINGS,
  ci: ACCEPTED_SECURITY_FINDINGS,
};
const ACCEPTED_FILE = 'scripts/dev/routine-accepted-findings.ts';
const LEVELS = ['ERROR', 'WARN', 'INFO'];
const DETAIL_LENGTH = 200;

function parseAdvisors(output: string): AdvisorFinding[] {
  const value = jsonValue(output);
  if (!isJson(value)) throw new Error('the output is not a JSON object');
  return jsonList(value.results).map((finding) => {
    const level = text(finding, 'level');
    if (!LEVELS.includes(level))
      throw new Error(`the output has an unknown level "${level}"`);
    return {
      name: text(finding, 'name'),
      level: level as AdvisorFinding['level'],
      cacheKey: text(finding, 'cacheKey'),
      detail: text(finding, 'detail'),
    };
  });
}

function shortDetail(detail: string): string {
  const flat = detail.replace(/\s+/g, ' ').trim();
  return flat.length > DETAIL_LENGTH
    ? `${flat.slice(0, DETAIL_LENGTH)}...`
    : flat;
}

// docs/maintenance.md, "Accepted findings". Reads the remote advisor of one type
// and prints only what changed: a finding no entry accepts, an accepted object
// no finding reports, and an entry whose tracking issue closed.
async function compareAdvisors(
  section: SectionBuilder,
  type: AcceptedAdvisorLint['type'],
  accepted: AcceptedLists,
): Promise<void> {
  const title = type === 'security' ? 'Security' : 'Performance';
  const entries = accepted.remote.filter((entry) => entry.type === type);
  const findings = await section.read(
    // `--remote` reads the lints of the linked project; it changes nothing.
    [
      'supabase',
      'db',
      'advisors',
      '--remote',
      '--type',
      type,
      '--level',
      'info',
      '--fail-on',
      'none',
      '--output-format',
      'json',
    ],
    parseAdvisors,
  );
  if (findings) {
    const wholeLints = new Set(
      entries.filter((e) => e.objects === 'all').map((e) => e.lint),
    );
    const listed = entries.flatMap((e) =>
      e.objects === 'all' ? [] : e.objects,
    );
    const isAccepted = (finding: AdvisorFinding) =>
      wholeLints.has(finding.name) ||
      listed.includes(finding.cacheKey) ||
      (type === 'security' && Object.hasOwn(accepted.ci, finding.cacheKey));
    const reported = new Set(findings.map((finding) => finding.cacheKey));
    section.lines.push(
      `${title} advisors: ${plural(findings.filter(isAccepted).length, 'accepted finding')} unchanged.`,
    );
    section.list(
      `${title} findings not accepted`,
      findings
        .filter((finding) => !isAccepted(finding))
        .map(
          (finding) =>
            `${finding.level} ${finding.cacheKey}: ${shortDetail(finding.detail)}`,
        ),
    );
    section.list(
      `Accepted ${type} objects no finding reports; remove them from ${ACCEPTED_FILE}`,
      listed.filter((key) => !reported.has(key)),
    );
  }

  const tracked = [
    ...new Set(entries.flatMap((e) => (e.trackedBy ? [e.trackedBy] : []))),
  ];
  if (tracked.length === 0) return;
  const closed: string[] = [];
  let readAll = true;
  for (const issue of tracked) {
    const state = await section.read(
      ['gh', 'issue', 'view', issue.replace(/^#/, ''), '--json', 'state'],
      (output) => {
        const value = jsonValue(output);
        if (!isJson(value)) throw new Error('the output is not a JSON object');
        return text(value, 'state');
      },
    );
    if (state === undefined) readAll = false;
    if (state === 'CLOSED') {
      const lints = entries
        .filter((e) => e.trackedBy === issue)
        .map((e) => e.lint);
      closed.push(`${issue} (${lints.join(', ')})`);
    }
  }
  // "none" only when every lookup answered.
  if (readAll || closed.length > 0)
    section.list(
      `Accepted ${type} findings whose tracking issue closed; each needs a new decision`,
      closed,
    );
}

function parseCount(output: string): number {
  const value = output.trim();
  if (!/^\d+$/.test(value)) throw new Error('the output is not a count');
  return Number(value);
}

// docs/maintenance.md, "B. Security". The --jq filter keeps only the ID, the
// severity, and the creation date, so an advisory description never reaches
// this script.
export async function collectSecurity(
  run: Runner,
  dates: RoutineDates,
  accepted: AcceptedLists = ACCEPTED,
): Promise<Section> {
  const section = new SectionBuilder(run);
  const drafts = await section.read(
    [
      'gh',
      'api',
      `${REPO_API}/security-advisories?state=draft`,
      '--jq',
      '[.[] | {ghsa_id, severity, created_at}]',
    ],
    capped(API_PAGE, PAGE_REACHED, (output) =>
      jsonList(jsonValue(output)).map((draft) => {
        const severity =
          typeof draft.severity === 'string' ? draft.severity : 'no severity';
        const age = daysBetween(text(draft, 'created_at'), dates.today);
        return `${text(draft, 'ghsa_id')} (${severity}, ${age} days old)`;
      }),
    ),
  );
  if (drafts) section.list('Draft advisories', drafts);

  const alerts = await section.read(
    [
      'gh',
      'api',
      `${REPO_API}/secret-scanning/alerts?state=open`,
      '--jq',
      'length',
    ],
    (output) => {
      const value = parseCount(output);
      if (value >= API_PAGE) throw new Error(PAGE_REACHED);
      return value;
    },
  );
  if (alerts !== undefined)
    section.lines.push(`Open secret scanning alerts: ${alerts}.`);
  await compareAdvisors(section, 'security', accepted);
  return section.done();
}

const FAILED_CONCLUSIONS = ['failure', 'timed_out', 'startup_failure'];

// docs/maintenance.md, "D. App health", steps 1 and 3. A failed run is explained
// when a later run of the same workflow on main succeeded; reading the failed
// logs stays with the agent, and so do Sentry and the health advisor.
export async function collectAppHealth(
  run: Runner,
  dates: RoutineDates,
  accepted: AcceptedLists = ACCEPTED,
): Promise<Section> {
  const section = new SectionBuilder(run);
  const runs = await section.read(
    [
      'gh',
      'run',
      'list',
      '--branch',
      'main',
      '--created',
      `>=${dates.since}`,
      '--limit',
      String(LIST_LIMIT),
      '--json',
      'databaseId,workflowName,displayTitle,createdAt,conclusion',
    ],
    capped(LIST_LIMIT, LIMIT_REACHED, (output) =>
      jsonList(jsonValue(output))
        .map((item) => ({
          id: count(item, 'databaseId'),
          workflow: text(item, 'workflowName'),
          title: text(item, 'displayTitle'),
          createdAt: text(item, 'createdAt'),
          // An unfinished run has an empty conclusion.
          conclusion:
            typeof item.conclusion === 'string' ? item.conclusion : '',
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    ),
  );
  if (runs)
    section.list(
      `Failed runs on main since ${dates.since}`,
      runs
        .filter((item) => FAILED_CONCLUSIONS.includes(item.conclusion))
        .map((failed) => {
          const green = runs.find(
            (item) =>
              item.workflow === failed.workflow &&
              item.createdAt > failed.createdAt &&
              item.conclusion === 'success',
          );
          const head = `${failed.workflow}: run ${failed.id} failed (${failed.createdAt}, "${failed.title}")`;
          return green
            ? `${head}; run ${green.id} succeeded later (${green.createdAt}).`
            : `${head}; no later run succeeded. Needs a decision; read gh run view ${failed.id} --log-failed.`;
        }),
    );
  await compareAdvisors(section, 'performance', accepted);
  return section.done();
}

// Lists issues with one `gh issue list` and a short description per issue.
async function listIssues(
  section: SectionBuilder,
  title: string,
  filters: string[],
  json: string,
  describe: (issue: Json) => string,
): Promise<void> {
  const items = await section.read(
    [
      'gh',
      'issue',
      'list',
      ...filters,
      '--limit',
      String(LIST_LIMIT),
      '--json',
      json,
    ],
    capped(LIST_LIMIT, LIMIT_REACHED, (output) =>
      byNumber(
        jsonList(jsonValue(output)).map((issue) => ({
          number: count(issue, 'number'),
          line: `#${count(issue, 'number')} ${text(issue, 'title')}${describe(issue)}`,
        })),
      ),
    ),
  );
  if (items)
    section.list(
      title,
      items.map((item) => item.line),
    );
}

// `gh issue list --json comments` returns at most this many comments per issue.
const COMMENT_LIMIT = 100;

// docs/maintenance.md, "E. Workflow", steps 1 to 3. It counts comments but never
// prints them: whether a comment is new evidence is the agent's call.
export async function collectWorkflow(
  run: Runner,
  dates: RoutineDates,
): Promise<Section> {
  const section = new SectionBuilder(run);
  const sinceStart = `${dates.since}T00:00:00Z`;
  const comments = (issue: Json) => jsonList(issue.comments ?? []);
  const mistake = ['--label', 'agent-mistake', '--search'];
  const tooling = [
    '--state',
    'open',
    '--label',
    'finding',
    '--label',
    'area:tooling',
    '--search',
  ];

  await listIssues(
    section,
    `Agent mistakes updated since ${dates.since}`,
    ['--state', 'all', ...mistake, `updated:>=${dates.since}`],
    'number,title,state,createdAt,comments',
    (issue) => {
      const state = text(issue, 'state').toLowerCase();
      if (text(issue, 'createdAt') >= sinceStart)
        return ` (${state}): first occurrence`;
      if (comments(issue).length >= COMMENT_LIMIT) {
        section.failed = true;
        return ` (${state}): Could not check its comments since ${dates.since}: gh returns at most ${COMMENT_LIMIT} comments; read gh issue view ${count(issue, 'number')} --comments.`;
      }
      const recent = comments(issue).filter(
        (comment) => text(comment, 'createdAt') >= sinceStart,
      ).length;
      return ` (${state}): ${plural(recent, 'comment')} since ${dates.since}`;
    },
  );
  await listIssues(
    section,
    'Open agent mistakes without a linked PR',
    ['--state', 'open', ...mistake, '-linked:pr'],
    'number,title,comments',
    (issue) => {
      if (comments(issue).length >= COMMENT_LIMIT) {
        section.failed = true;
        return ` (Could not check its comment count: gh returns at most ${COMMENT_LIMIT} comments; read gh issue view ${count(issue, 'number')} --comments.)`;
      }
      return ` (${plural(comments(issue).length, 'comment')})`;
    },
  );
  await listIssues(
    section,
    `Tooling findings created since ${dates.since}`,
    [...tooling, `created:>=${dates.since}`],
    'number,title',
    () => '',
  );
  await listIssues(
    section,
    `Tooling findings without a linked PR, created before ${dates.untaken}`,
    [...tooling, `-linked:pr created:<${dates.untaken}`],
    'number,title,createdAt',
    (issue) => ` (created ${text(issue, 'createdAt').slice(0, 10)})`,
  );
  return section.done();
}

type Worktree = { path: string; branch: string; prunable: boolean };

function parseWorktrees(output: string): Worktree[] {
  return output
    .split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/).filter((line) => line !== ''))
    .filter((lines) => lines.length > 0)
    .map((lines) => {
      const field = (key: string) =>
        lines
          .find((line) => line === key || line.startsWith(`${key} `))
          ?.slice(key.length + 1);
      const path = field('worktree');
      if (!path) throw new Error('a worktree entry has no worktree line');
      return {
        path,
        branch:
          field('branch')?.replace(/^refs\/heads\//, '') ??
          (field('detached') !== undefined ? 'detached HEAD' : 'no branch'),
        prunable: field('prunable') !== undefined,
      };
    });
}

// `-z` output: NUL-delimited paths that Git never quotes.
const nulPaths = (output: string) =>
  output.split('\0').filter((path) => path !== '');

// `git status --porcelain -z`: one `XY path` record per file; a rename or copy
// record is followed by its source path.
function parseStatus(output: string): { count: number; paths: string[] } {
  const records = nulPaths(output);
  const paths: string[] = [];
  let count = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.length < 4 || record[2] !== ' ')
      throw new Error(`the output has a malformed status record "${record}"`);
    count++;
    paths.push(record.slice(3));
    if (/[RC]/.test(record.slice(0, 2))) {
      const source = records[++i];
      if (source === undefined)
        throw new Error(`the rename record "${record}" has no source path`);
      paths.push(source);
    }
  }
  return { count, paths };
}
const LOCKFILE = /(^|\/)(bun\.lock|package\.json)$/;
const CANDIDATE_VIEWS = '/.git/gentle-ai/candidate-views/';
const ACTIVE_DAYS = 3;

// docs/maintenance.md, "Worktrees". A worktree is active when it has
// uncommitted files, commits ahead of origin/main, or a recent commit.
export async function collectWorktrees(
  run: Runner,
  dates: RoutineDates,
): Promise<Section> {
  const section = new SectionBuilder(run);
  const normal = (path: string) => path.replace(/\\/g, '/').toLowerCase();
  const top = await section.read(
    ['git', 'rev-parse', '--show-toplevel'],
    (output) => normal(output.trim()),
  );
  const trees = await section.read(
    ['git', 'worktree', 'list', '--porcelain'],
    parseWorktrees,
  );
  if (top === undefined || !trees) return section.done();

  const active: string[] = [];
  const inactive: string[] = [];
  for (const tree of trees) {
    if (
      normal(tree.path) === top ||
      normal(tree.path).includes(CANDIDATE_VIEWS)
    )
      continue;
    const name = `${tree.path} (${tree.branch})`;
    if (tree.prunable) {
      inactive.push(`${name}: prunable, its directory is gone`);
      continue;
    }
    const git = (...args: string[]) => ['git', '-C', tree.path, ...args];
    // Every untracked file, not only its folder, whatever the local settings.
    const status = await section.read(
      git('status', '--porcelain', '-z', '--untracked-files=all'),
      parseStatus,
    );
    const ahead = await section.read(
      git('rev-list', '--count', 'origin/main..HEAD'),
      parseCount,
    );
    const age = await section.read(
      git('log', '-1', '--format=%cI'),
      (output) => ({
        day: isoDate(new Date(output.trim())),
        days: daysBetween(output.trim(), dates.today),
      }),
    );
    const changed = await section.read(
      // A renamed manifest also counts by its source path.
      git('diff', '--name-only', '--no-renames', '-z', 'origin/main...HEAD'),
      nulPaths,
    );
    if (!status || ahead === undefined || !age || !changed) continue;

    const files = [...changed, ...status.paths];
    const lockfiles = [
      ...new Set(files.filter((file) => LOCKFILE.test(file))),
    ].sort();
    const summary = `${name}: ${plural(status.count, 'uncommitted file')}, ${plural(ahead, 'commit')} ahead of origin/main, last commit ${age.day} (${plural(age.days, 'day')} ago)`;
    if (status.count > 0 || ahead > 0 || age.days <= ACTIVE_DAYS)
      active.push(
        `${summary}; lockfiles changed: ${lockfiles.join(', ') || 'none'}`,
      );
    else inactive.push(summary);
  }
  section.list('Active worktrees', active);
  section.list('Inactive worktrees', inactive);
  return section.done();
}

// ---------------------------------------------------------------- report

export async function collectRoutine(
  run: Runner,
  now: Date,
): Promise<{ text: string; failed: boolean }> {
  const dates = routineDates(now);
  const sections: [string, Promise<Section>][] = [
    ['A. Dependencies', collectDependencies(run, dates)],
    ['B. Security', collectSecurity(run, dates)],
    ['C. Backlog', collectBacklog(run, dates)],
    ['D. App health', collectAppHealth(run, dates)],
    ['E. Workflow', collectWorkflow(run, dates)],
    ['Worktrees', collectWorktrees(run, dates)],
  ];
  const lines = [
    `# Routine data, ${dates.today}, ISO week ${dates.isoWeek}`,
    '',
    `Topic of the week: ${dates.topic} (ISO week ${dates.isoWeek} % ${TOPICS.length} = ${dates.isoWeek % TOPICS.length}).`,
    `Dates: since ${dates.since}, stale before ${dates.stale}, untaken before ${dates.untaken}, dependency runs since ${dates.sunday}.`,
  ];
  let failed = false;
  for (const [title, pending] of sections) {
    const section = await pending;
    failed ||= section.failed;
    lines.push('', `## ${title}`, '', ...section.lines);
  }
  return { text: lines.join('\n'), failed };
}

const runCommand: Runner = async (cmd) => {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `exit ${code}: ${(stderr.trim() || stdout.trim()).slice(0, 500)}`,
    );
  return stdout;
};

async function main(args: string[]): Promise<number> {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(USAGE);
    return 0;
  }
  if (args.length > 0) {
    console.error(USAGE);
    return 2;
  }
  const report = await collectRoutine(runCommand, new Date());
  console.log(report.text);
  return report.failed ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
