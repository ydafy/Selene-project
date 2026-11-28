import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

import {
  collectBacklog,
  collectDependencies,
  collectRoutine,
  routineDates,
  type Runner,
} from './routine-collect';

const SCRIPT = join(import.meta.dir, 'routine-collect.ts');
// Monday of ISO week 49: since 2026-11-23, Sunday 2026-11-29.
const NOW = new Date('2026-11-30T15:00:00Z');
const DATES = routineDates(NOW);

// Answers each command by its exact text; any other command fails the test.
function fakeRun(responses: Record<string, string | Error>): Runner {
  return async (cmd) => {
    const key = cmd.join(' ');
    const response = responses[key];
    if (response === undefined) throw new Error(`unexpected command: ${key}`);
    if (response instanceof Error) throw response;
    return response;
  };
}

const runList = (workflow: string, event: string) =>
  `gh run list --workflow ${workflow} --event ${event} -L 3 --json databaseId,createdAt,status,event`;
const runView = (id: number) => `gh run view ${id} --json jobs`;
const REPORT_ISSUES =
  'gh issue list --search Reporte de dependencias in:title --state open --json number,title,body';
// "Could not check" lines quote an argument that has spaces, so it can be pasted.
const REPORT_ISSUES_SHOWN =
  'gh issue list --search "Reporte de dependencias in:title" --state open --json number,title,body';

function runs(...items: [number, string, string, string][]): string {
  return JSON.stringify(
    items.map(([databaseId, createdAt, status, event]) => ({
      databaseId,
      createdAt,
      status,
      event,
    })),
  );
}

function jobs(...items: [string, string][]): string {
  return JSON.stringify({
    jobs: items.map(([name, conclusion]) => ({ name, conclusion, steps: [] })),
  });
}

const REPORT_BODY =
  '# Dependency report, 2026-11-29\n\n22 safe updates, 3 majors, 0 vulnerabilities.\n\n## Majors available\n';

function dependencyResponses(
  overrides: Record<string, string | Error> = {},
): Record<string, string | Error> {
  return {
    [runList('dependency-audit.yml', 'schedule')]: runs(
      [11, '2026-11-29T14:30:00Z', 'completed', 'schedule'],
      [10, '2026-11-22T14:20:00Z', 'completed', 'schedule'],
    ),
    [runList('dependency-audit.yml', 'workflow_dispatch')]: runs(),
    [runView(11)]: jobs(['should-run', 'success'], ['audit', 'success']),
    [runList('dependency-report.yml', 'schedule')]: runs(
      [21, '2026-11-29T20:55:00Z', 'completed', 'schedule'],
      [20, '2026-11-29T15:00:00Z', 'completed', 'schedule'],
    ),
    [runList('dependency-report.yml', 'workflow_dispatch')]: runs(),
    [runView(21)]: jobs(['should-run', 'success'], ['report', 'skipped']),
    [runView(20)]: jobs(['should-run', 'success'], ['report', 'success']),
    [REPORT_ISSUES]: JSON.stringify([
      { number: 95, title: 'Reporte de dependencias', body: REPORT_BODY },
    ]),
    ...overrides,
  };
}

describe('routineDates', () => {
  it('derives the routine dates, the ISO week, and the topic of the week', () => {
    expect(DATES).toEqual({
      today: '2026-11-30',
      since: '2026-11-23',
      stale: '2026-10-01',
      untaken: '2026-11-16',
      sunday: '2026-11-29',
      isoWeek: 49,
      topic: 'orders',
    });
  });

  it('matches the example in docs/maintenance.md: week 46 is tooling', () => {
    expect(routineDates(new Date('2026-11-09T12:00:00Z')).topic).toBe(
      'tooling',
    );
  });

  it('counts a Sunday as its own dependency Sunday', () => {
    expect(routineDates(new Date('2026-11-29T23:00:00Z')).sunday).toBe(
      '2026-11-29',
    );
  });
});

describe('collectDependencies', () => {
  it('reports the latest run whose work job ran, ignoring skipped backup runs', async () => {
    const section = await collectDependencies(
      fakeRun(dependencyResponses()),
      DATES,
    );
    expect(section.failed).toBe(false);
    expect(section.lines).toEqual([
      'dependency-audit.yml: the audit job ran in run 11 (schedule, 2026-11-29T14:30:00Z): success.',
      'dependency-report.yml: the report job ran in run 20 (schedule, 2026-11-29T15:00:00Z): success.',
      'Report issue #95 (report of 2026-11-29): 22 safe updates, 3 majors, 0 vulnerabilities.',
    ]);
  });

  it('asks for a rerun when the latest report job failed, and a decision when the audit failed', async () => {
    const section = await collectDependencies(
      fakeRun(
        dependencyResponses({
          [runView(11)]: jobs(['should-run', 'success'], ['audit', 'failure']),
          [runView(20)]: jobs(['should-run', 'success'], ['report', 'failure']),
        }),
      ),
      DATES,
    );
    expect(section.lines.slice(0, 2)).toEqual([
      'dependency-audit.yml: the audit job ran in run 11 (schedule, 2026-11-29T14:30:00Z): failure. Needs a decision.',
      'dependency-report.yml: the report job ran in run 20 (schedule, 2026-11-29T15:00:00Z): failure. Rerun the report (docs/maintenance.md, "A. Dependencies", step 1).',
    ]);
  });

  it('asks to start a workflow with no run since Sunday, and to wait for a pending one', async () => {
    const section = await collectDependencies(
      fakeRun(
        dependencyResponses({
          [runList('dependency-audit.yml', 'schedule')]: runs([
            10,
            '2026-11-22T14:20:00Z',
            'completed',
            'schedule',
          ]),
          [runList('dependency-report.yml', 'workflow_dispatch')]: runs([
            22,
            '2026-11-30T14:00:00Z',
            'in_progress',
            'workflow_dispatch',
          ]),
          [runList('dependency-report.yml', 'schedule')]: runs(),
        }),
      ),
      DATES,
    );
    expect(section.lines.slice(0, 2)).toEqual([
      'dependency-audit.yml: no run since 2026-11-29 ran the audit job. Start it (docs/dependencies.md).',
      'dependency-report.yml: run 22 (workflow_dispatch) is in_progress. Wait for it.',
    ]);
  });

  it('counts a manual run like a scheduled one', async () => {
    const section = await collectDependencies(
      fakeRun(
        dependencyResponses({
          [runList('dependency-report.yml', 'schedule')]: runs(),
          [runList('dependency-report.yml', 'workflow_dispatch')]: runs([
            23,
            '2026-11-30T09:00:00Z',
            'completed',
            'workflow_dispatch',
          ]),
          [runView(23)]: jobs(['should-run', 'success'], ['report', 'success']),
        }),
      ),
      DATES,
    );
    expect(section.lines[1]).toBe(
      'dependency-report.yml: the report job ran in run 23 (workflow_dispatch, 2026-11-30T09:00:00Z): success.',
    );
  });

  it('flags a report issue older than Sunday and a missing report issue', async () => {
    const old = await collectDependencies(
      fakeRun(
        dependencyResponses({
          [REPORT_ISSUES]: JSON.stringify([
            {
              number: 95,
              title: 'Reporte de dependencias',
              body: REPORT_BODY.replace('2026-11-29', '2026-11-24'),
            },
          ]),
        }),
      ),
      DATES,
    );
    expect(old.lines[2]).toBe(
      'Report issue #95 (report of 2026-11-24, before 2026-11-29): 22 safe updates, 3 majors, 0 vulnerabilities.',
    );

    const none = await collectDependencies(
      fakeRun(dependencyResponses({ [REPORT_ISSUES]: '[]' })),
      DATES,
    );
    expect(none.lines[2]).toBe('No open "Reporte de dependencias" issue.');
  });

  it('turns a failed command into a "Could not check" line and keeps the other checks', async () => {
    const section = await collectDependencies(
      fakeRun(
        dependencyResponses({
          [runList('dependency-audit.yml', 'schedule')]: new Error(
            'exit 4: gh auth login required',
          ),
        }),
      ),
      DATES,
    );
    expect(section.failed).toBe(true);
    expect(section.lines).toEqual([
      `Could not check: ${runList('dependency-audit.yml', 'schedule')}: exit 4: gh auth login required`,
      'dependency-report.yml: the report job ran in run 20 (schedule, 2026-11-29T15:00:00Z): success.',
      'Report issue #95 (report of 2026-11-29): 22 safe updates, 3 majors, 0 vulnerabilities.',
    ]);
  });

  it('treats output that is not the expected JSON as a failed check', async () => {
    const section = await collectDependencies(
      fakeRun(dependencyResponses({ [REPORT_ISSUES]: 'not json' })),
      DATES,
    );
    expect(section.failed).toBe(true);
    expect(section.lines[2]).toStartWith(
      `Could not check: ${REPORT_ISSUES_SHOWN}: `,
    );
  });
});

const OPEN_ISSUES =
  'gh issue list --state open --limit 1000 --json number,title,labels,milestone,createdAt,updatedAt';
const CLOSED_GO_LIVE =
  'gh issue list --state closed --milestone Go-live --search closed:>=2026-11-23 --limit 200 --json number,title';
const OPEN_PRS =
  'gh pr list --state open --limit 200 --json number,title,createdAt,isDraft';

type IssueFixture = {
  number: number;
  title: string;
  labels?: string[];
  milestone?: string;
  createdAt?: string;
  updatedAt?: string;
};

function issues(...items: IssueFixture[]): string {
  return JSON.stringify(
    items.map((item) => ({
      number: item.number,
      title: item.title,
      labels: (item.labels ?? []).map((name) => ({ name, color: 'ededed' })),
      milestone: item.milestone ? { title: item.milestone } : null,
      createdAt: item.createdAt ?? '2026-11-01T10:00:00Z',
      updatedAt: item.updatedAt ?? '2026-11-25T10:00:00Z',
    })),
  );
}

function backlogResponses(
  overrides: Record<string, string | Error> = {},
): Record<string, string | Error> {
  return {
    [OPEN_ISSUES]: issues(
      {
        number: 730,
        title: '[Finding] New tooling bug',
        labels: ['finding', 'priority:medium', 'area:tooling'],
        createdAt: '2026-11-24T10:00:00Z',
      },
      {
        number: 731,
        title: 'Finding: unlabeled launch blocker',
        milestone: 'Go-live',
        createdAt: '2026-11-25T10:00:00Z',
      },
      {
        number: 500,
        title: '[Finding] Payout drift',
        labels: ['finding', 'priority:critical'],
        milestone: 'Go-live',
        updatedAt: '2026-11-20T10:00:00Z',
      },
      {
        number: 400,
        title: '[Finding] Old finding without priority',
        labels: ['finding'],
        updatedAt: '2026-09-15T10:00:00Z',
      },
      {
        number: 401,
        title: '[Idea] Some idea',
        labels: ['idea', 'priority:high'],
      },
    ),
    [CLOSED_GO_LIVE]: JSON.stringify([
      { number: 450, title: 'Closed blocker' },
    ]),
    [OPEN_PRS]: JSON.stringify([
      {
        number: 760,
        title: 'feat: recent',
        createdAt: '2026-11-29T10:00:00Z',
        isDraft: false,
      },
      {
        number: 700,
        title: 'feat: old draft',
        createdAt: '2026-11-10T10:00:00Z',
        isDraft: true,
      },
    ]),
    ...overrides,
  };
}

describe('collectBacklog', () => {
  it('summarizes the open issues and PRs the backlog check reads', async () => {
    const section = await collectBacklog(fakeRun(backlogResponses()), DATES);
    expect(section.failed).toBe(false);
    expect(section.lines).toEqual([
      'Open issues: 5. Open PRs: 2.',
      'New since 2026-11-23 (2):',
      '- #730 [Finding] New tooling bug (finding, priority:medium, area:tooling)',
      '- #731 Finding: unlabeled launch blocker (no labels; milestone Go-live)',
      'Go-live: 2 open (1 created since 2026-11-23), 1 closed since 2026-11-23.',
      'Critical (1):',
      '- #500 [Finding] Payout drift',
      'High (1):',
      '- #401 [Idea] Some idea',
      'Findings without a priority (1):',
      '- #400 [Finding] Old finding without priority',
      'Titles that name a type its labels lack (1):',
      '- #731 Finding: unlabeled launch blocker: no finding label',
      'Stale, not updated since 2026-10-01 (1):',
      '- #400 [Finding] Old finding without priority (updated 2026-09-15)',
      'PRs open more than 7 days (1):',
      '- #700 feat: old draft (opened 2026-11-10, draft)',
    ]);
  });

  it('writes "none" for an empty list', async () => {
    const section = await collectBacklog(
      fakeRun(
        backlogResponses({
          [OPEN_ISSUES]: issues({
            number: 1,
            title: 'Plain issue',
            labels: ['priority:low'],
          }),
          [CLOSED_GO_LIVE]: '[]',
          [OPEN_PRS]: '[]',
        }),
      ),
      DATES,
    );
    expect(section.lines).toEqual([
      'Open issues: 1. Open PRs: 0.',
      'New since 2026-11-23: none.',
      'Go-live: 0 open (0 created since 2026-11-23), 0 closed since 2026-11-23.',
      'Critical: none.',
      'High: none.',
      'Findings without a priority: none.',
      'Titles that name a type its labels lack: none.',
      'Stale, not updated since 2026-10-01: none.',
      'PRs open more than 7 days: none.',
    ]);
  });

  it('refuses a truncated issue list instead of undercounting', async () => {
    const many = issues(
      ...Array.from({ length: 1000 }, (_, i) => ({
        number: i + 1,
        title: `Issue ${i + 1}`,
      })),
    );
    const section = await collectBacklog(
      fakeRun(backlogResponses({ [OPEN_ISSUES]: many })),
      DATES,
    );
    expect(section.failed).toBe(true);
    expect(section.lines[0]).toBe(
      `Could not check: ${OPEN_ISSUES}: the list reached its limit of 1000; raise --limit.`,
    );
  });

  it('keeps the PR check when the issue list fails', async () => {
    const section = await collectBacklog(
      fakeRun(
        backlogResponses({ [OPEN_ISSUES]: new Error('exit 1: HTTP 502') }),
      ),
      DATES,
    );
    expect(section.failed).toBe(true);
    expect(section.lines).toEqual([
      `Could not check: ${OPEN_ISSUES}: exit 1: HTTP 502`,
      'Open PRs: 2.',
      'PRs open more than 7 days (1):',
      '- #700 feat: old draft (opened 2026-11-10, draft)',
    ]);
  });
});

describe('collectRoutine', () => {
  it('prints the header and every section, and reports whether a check failed', async () => {
    const ok = await collectRoutine(
      fakeRun({ ...dependencyResponses(), ...backlogResponses() }),
      NOW,
    );
    expect(ok.failed).toBe(false);
    expect(ok.text.split('\n').slice(0, 6)).toEqual([
      '# Routine data, 2026-11-30, ISO week 49',
      '',
      'Topic of the week: orders (ISO week 49 % 8 = 1).',
      'Dates: since 2026-11-23, stale before 2026-10-01, untaken before 2026-11-16, dependency runs since 2026-11-29.',
      '',
      '## A. Dependencies',
    ]);
    expect(ok.text).toContain(
      '\n## C. Backlog\n\nOpen issues: 5. Open PRs: 2.\n',
    );

    const failing = await collectRoutine(
      fakeRun({
        ...dependencyResponses({ [REPORT_ISSUES]: new Error('exit 1') }),
        ...backlogResponses(),
      }),
      NOW,
    );
    expect(failing.failed).toBe(true);
  });
});

describe('routine-collect CLI', () => {
  it('prints its usage for --help and exits 0', () => {
    const run = Bun.spawnSync(['bun', SCRIPT, '--help']);
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toBe(
      'Usage: bun run routine:collect\nPrints the weekly routine data of docs/maintenance.md. It only reads.\n',
    );
    expect(run.stderr.toString()).toBe('');
  });

  it('rejects an unknown argument with its usage and exit 2', () => {
    const run = Bun.spawnSync(['bun', SCRIPT, '--yes']);
    expect(run.exitCode).toBe(2);
    expect(run.stdout.toString()).toBe('');
    expect(run.stderr.toString()).toBe(
      'Usage: bun run routine:collect\nPrints the weekly routine data of docs/maintenance.md. It only reads.\n',
    );
  });
});
