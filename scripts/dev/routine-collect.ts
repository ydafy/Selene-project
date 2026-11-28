// Collects the data of the weekly routine (docs/maintenance.md) and prints a short
// summary, so the agent reads one report instead of many raw outputs. It only
// reads: it never starts a workflow, edits an issue, or writes a file. It decides
// only what a command can compute; judging the data stays with the agent and the
// maintainer. A failed command prints "Could not check" in its section, the other
// checks still run, and the script exits 1.

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
  },
];
const REPORT_ISSUES = [
  'gh',
  'issue',
  'list',
  '--search',
  'Reporte de dependencias in:title',
  '--state',
  'open',
  '--json',
  'number,title,body',
];
const REPORT_TITLE = /^# Dependency report, (\d{4}-\d{2}-\d{2})\s*$/;

// docs/maintenance.md, "A. Dependencies". A run counts only when its work job
// ran: a backup run that found an earlier run skips that job and still succeeds.
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
          '--event',
          event,
          '-L',
          '3',
          '--json',
          'databaseId,createdAt,status,event',
        ],
        parseRuns,
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
      const next = conclusion === 'success' ? '' : ` ${workflow.onFailure}`;
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
    jsonList(jsonValue(output)).map((issue) => ({
      number: count(issue, 'number'),
      body: text(issue, 'body'),
    })),
  );
  if (reports?.length === 0)
    section.lines.push('No open "Reporte de dependencias" issue.');
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
  '200',
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
  const prs = await section.read(OPEN_PRS, (output) =>
    byNumber(
      jsonList(jsonValue(output)).map((pr) => ({
        number: count(pr, 'number'),
        title: text(pr, 'title'),
        createdAt: text(pr, 'createdAt'),
        isDraft: pr.isDraft === true,
      })),
    ),
  );
  const closedGoLive = open
    ? await section.read(
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
          '200',
          '--json',
          'number,title',
        ],
        (output) => jsonList(jsonValue(output)),
      )
    : undefined;

  const counts = [
    open ? `Open issues: ${open.length}.` : '',
    prs ? `Open PRs: ${prs.length}.` : '',
  ].filter(Boolean);
  if (counts.length > 0) section.lines.push(counts.join(' '));

  if (open) {
    const has = (issue: Issue, label: string) => issue.labels.includes(label);
    section.list(
      `New since ${dates.since}`,
      open
        .filter((issue) => issue.createdAt >= sinceStart)
        .map(
          (issue) =>
            `#${issue.number} ${issue.title} (${describeLabels(issue)})`,
        ),
    );

    const goLive = open.filter((issue) => issue.milestone === 'Go-live');
    const createdThisWeek = goLive.filter(
      (issue) => issue.createdAt >= sinceStart,
    ).length;
    const closed = closedGoLive
      ? `, ${closedGoLive.length} closed since ${dates.since}`
      : '';
    // Only the count and its change: listing every launch blocker each week is
    // noise (53 on 2026-11-28).
    section.lines.push(
      `Go-live: ${goLive.length} open (${createdThisWeek} created since ${dates.since})${closed}.`,
    );

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

// ---------------------------------------------------------------- report

export async function collectRoutine(
  run: Runner,
  now: Date,
): Promise<{ text: string; failed: boolean }> {
  const dates = routineDates(now);
  const sections: [string, Promise<Section>][] = [
    ['A. Dependencies', collectDependencies(run, dates)],
    ['C. Backlog', collectBacklog(run, dates)],
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
