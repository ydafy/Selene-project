import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

import {
  collectAppHealth,
  collectBacklog,
  collectDependencies,
  collectRoutine,
  collectSecurity,
  collectWorkflow,
  collectWorktrees,
  routineDates,
  type AcceptedLists,
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
  `gh run list --workflow ${workflow} --branch main --event ${event} --created >=2026-11-29 --limit 200 --json databaseId,createdAt,status,event`;
const runView = (id: number) => `gh run view ${id} --json jobs`;
const REPORT_ISSUES =
  'gh issue list --author app/github-actions --search Reporte de dependencias in:title --state open --json number,title,body';
// "Could not check" lines quote an argument that has spaces, so it can be pasted.
const REPORT_ISSUES_SHOWN =
  'gh issue list --author app/github-actions --search "Reporte de dependencias in:title" --state open --json number,title,body';

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
    expect(none.lines[2]).toBe(
      'No open "Reporte de dependencias" issue by app/github-actions.',
    );
  });

  it('reads only the issue with the exact report title', async () => {
    const section = await collectDependencies(
      fakeRun(
        dependencyResponses({
          [REPORT_ISSUES]: JSON.stringify([
            {
              number: 96,
              title: 'Reporte de dependencias (copia)',
              body: REPORT_BODY.replace('22 safe', '0 safe'),
            },
            { number: 95, title: 'Reporte de dependencias', body: REPORT_BODY },
          ]),
        }),
      ),
      DATES,
    );
    expect(section.lines.slice(2)).toEqual([
      'Report issue #95 (report of 2026-11-29): 22 safe updates, 3 majors, 0 vulnerabilities.',
    ]);
  });

  it('keeps an earlier report failure but drops the rerun step while a report run is pending', async () => {
    const section = await collectDependencies(
      fakeRun(
        dependencyResponses({
          [runView(20)]: jobs(['should-run', 'success'], ['report', 'failure']),
          [runList('dependency-report.yml', 'workflow_dispatch')]: runs([
            22,
            '2026-11-30T14:00:00Z',
            'queued',
            'workflow_dispatch',
          ]),
        }),
      ),
      DATES,
    );
    expect(section.lines.slice(1, 3)).toEqual([
      'dependency-report.yml: run 22 (workflow_dispatch) is queued. Wait for it.',
      'dependency-report.yml: the report job ran in run 20 (schedule, 2026-11-29T15:00:00Z): failure.',
    ]);
  });

  it('refuses a run list that reached its limit', async () => {
    const full = runs(
      ...Array.from(
        { length: 200 },
        (_, i): [number, string, string, string] => [
          100 + i,
          '2026-11-29T15:00:00Z',
          'completed',
          'schedule',
        ],
      ),
    );
    const section = await collectDependencies(
      fakeRun(
        dependencyResponses({
          [runList('dependency-audit.yml', 'schedule')]: full,
        }),
      ),
      DATES,
    );
    expect(section.failed).toBe(true);
    expect(section.lines[0]).toBe(
      `Could not check: ${runList('dependency-audit.yml', 'schedule')}: the list reached its limit of 200; raise --limit.`,
    );
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
  'gh issue list --state closed --milestone Go-live --search closed:>=2026-11-23 --limit 200 --json number,title,createdAt';
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
    // #450 opened and closed this week, so it counts as created too.
    [CLOSED_GO_LIVE]: JSON.stringify([
      {
        number: 450,
        title: 'Closed blocker',
        createdAt: '2026-11-24T10:00:00Z',
      },
      { number: 451, title: 'Old blocker', createdAt: '2026-10-01T10:00:00Z' },
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

const BACKLOG_NEW = [
  'New since 2026-11-23 (2):',
  '- #730 [Finding] New tooling bug (finding, priority:medium, area:tooling)',
  '- #731 Finding: unlabeled launch blocker (no labels; milestone Go-live)',
];
const BACKLOG_ISSUE_LISTS = [
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
];
const BACKLOG_PRS = [
  'PRs open more than 7 days (1):',
  '- #700 feat: old draft (opened 2026-11-10, draft)',
];

describe('collectBacklog', () => {
  it('summarizes the open issues and PRs the backlog check reads', async () => {
    const section = await collectBacklog(fakeRun(backlogResponses()), DATES);
    expect(section.failed).toBe(false);
    expect(section.lines).toEqual([
      'Open issues: 5. Open PRs: 2.',
      'New since 2026-11-23 (2):',
      '- #730 [Finding] New tooling bug (finding, priority:medium, area:tooling)',
      '- #731 Finding: unlabeled launch blocker (no labels; milestone Go-live)',
      'Go-live: 2 open (2 created since 2026-11-23), 2 closed since 2026-11-23.',
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

  it('keeps the PR check and the Go-live closures when the issue list fails', async () => {
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
      'Go-live: 2 closed since 2026-11-23.',
      ...BACKLOG_PRS,
    ]);
  });

  it('refuses a PR list that reached its limit and keeps the issue results', async () => {
    const full = JSON.stringify(
      Array.from({ length: 200 }, (_, i) => ({
        number: i + 1,
        title: 'x',
        createdAt: '2026-11-01T10:00:00Z',
        isDraft: false,
      })),
    );
    const section = await collectBacklog(
      fakeRun(backlogResponses({ [OPEN_PRS]: full })),
      DATES,
    );
    expect(section.failed).toBe(true);
    expect(section.lines).toEqual([
      `Could not check: ${OPEN_PRS}: the list reached its limit of 200; raise --limit.`,
      'Open issues: 5.',
      ...BACKLOG_NEW,
      'Go-live: 2 open (2 created since 2026-11-23), 2 closed since 2026-11-23.',
      ...BACKLOG_ISSUE_LISTS,
    ]);
  });

  it('keeps the open Go-live count when the closure list reached its limit', async () => {
    const full = JSON.stringify(
      Array.from({ length: 200 }, (_, i) => ({
        number: i + 1,
        title: 'x',
        createdAt: '2026-11-01T10:00:00Z',
      })),
    );
    const section = await collectBacklog(
      fakeRun(backlogResponses({ [CLOSED_GO_LIVE]: full })),
      DATES,
    );
    expect(section.failed).toBe(true);
    expect(section.lines).toEqual([
      `Could not check: ${CLOSED_GO_LIVE}: the list reached its limit of 200; raise --limit.`,
      'Open issues: 5. Open PRs: 2.',
      ...BACKLOG_NEW,
      'Go-live: 2 open; created and closed since 2026-11-23 not checked.',
      ...BACKLOG_ISSUE_LISTS,
      ...BACKLOG_PRS,
    ]);
  });
});

const ADVISORIES =
  'gh api repos/ydafy/Selene-project/security-advisories?state=draft --jq [.[] | {ghsa_id, severity, created_at}]';
const SECRETS =
  'gh api repos/ydafy/Selene-project/secret-scanning/alerts?state=open --jq length';
const advisors = (type: string) =>
  `supabase db advisors --remote --type ${type} --level info --fail-on none --output-format json`;
const SECURITY_ADVISORS = advisors('security');
const PERFORMANCE_ADVISORS = advisors('performance');

function findings(...items: [string, string, string, string][]): string {
  return JSON.stringify({
    results: items.map(([name, level, cacheKey, detail]) => ({
      name,
      level,
      cacheKey,
      detail,
      title: 'not printed',
    })),
    message: '',
    target: 'remote',
  });
}

const ACCEPTED: AcceptedLists = {
  remote: [
    {
      type: 'security',
      lint: 'rls_enabled_no_policy',
      objects: [
        'rls_enabled_no_policy_public_a',
        'rls_enabled_no_policy_public_gone',
      ],
      reason: 'Server-owned.',
      trackedBy: '#434',
    },
    {
      type: 'security',
      lint: 'auth_leaked_password_protection',
      objects: ['auth_leaked_password_protection'],
      reason: 'Needs the Pro plan.',
      trackedBy: '#313',
    },
    {
      type: 'performance',
      lint: 'unused_index',
      objects: 'all',
      reason: 'Test data.',
    },
  ],
  ci: { security_definer_view_public_products_public: 'Decided.' },
};
const NEW_FUNCTION =
  'authenticated_security_definer_function_executable_public_fn_new_';

function securityResponses(
  overrides: Record<string, string | Error> = {},
): Record<string, string | Error> {
  return {
    // The --jq filter keeps only these fields; a description never arrives.
    [ADVISORIES]: JSON.stringify([
      {
        ghsa_id: 'GHSA-aaaa-bbbb-cccc',
        severity: 'high',
        created_at: '2026-11-20T10:00:00Z',
      },
      {
        ghsa_id: 'GHSA-dddd-eeee-ffff',
        severity: null,
        created_at: '2026-11-30T08:00:00Z',
      },
    ]),
    [SECRETS]: '2\n',
    [SECURITY_ADVISORS]: findings(
      ['rls_enabled_no_policy', 'INFO', 'rls_enabled_no_policy_public_a', 'a'],
      [
        'auth_leaked_password_protection',
        'WARN',
        'auth_leaked_password_protection',
        'b',
      ],
      [
        'security_definer_view',
        'ERROR',
        'security_definer_view_public_products_public',
        'c',
      ],
      [
        'authenticated_security_definer_function_executable',
        'WARN',
        NEW_FUNCTION,
        `Function   fn_new\n${'x'.repeat(250)}`,
      ],
    ),
    'gh issue view 434 --json state': '{"state":"OPEN"}',
    'gh issue view 313 --json state': '{"state":"CLOSED"}',
    ...overrides,
  };
}

describe('collectSecurity', () => {
  it('prints the drafts, the secret alerts, and only the advisor findings that changed', async () => {
    const section = await collectSecurity(
      fakeRun(securityResponses()),
      DATES,
      ACCEPTED,
    );
    expect(section.failed).toBe(false);
    expect(section.lines).toEqual([
      'Draft advisories (2):',
      '- GHSA-aaaa-bbbb-cccc (high, 10 days old)',
      '- GHSA-dddd-eeee-ffff (no severity, 0 days old)',
      'Open secret scanning alerts: 2.',
      'Security advisors: 3 accepted findings unchanged.',
      'Security findings not accepted (1):',
      `- WARN ${NEW_FUNCTION}: Function fn_new ${'x'.repeat(184)}...`,
      'Accepted security objects no finding reports; remove them from scripts/dev/routine-accepted-findings.ts (1):',
      '- rls_enabled_no_policy_public_gone',
      'Accepted security findings whose tracking issue closed; each needs a new decision (1):',
      '- #313 (auth_leaked_password_protection)',
    ]);
  });

  it('fails closed on an advisor output without a results list and still reads the issues', async () => {
    const section = await collectSecurity(
      fakeRun(
        securityResponses({
          [SECURITY_ADVISORS]: '{"message":"not linked"}',
          'gh issue view 313 --json state': '{"state":"OPEN"}',
        }),
      ),
      DATES,
      ACCEPTED,
    );
    expect(section.failed).toBe(true);
    expect(section.lines.slice(4)).toEqual([
      `Could not check: ${SECURITY_ADVISORS}: the output is not a JSON list of objects`,
      'Accepted security findings whose tracking issue closed; each needs a new decision: none.',
    ]);
  });

  it('prints "none" for the tracking issues only when every lookup succeeded, and keeps a confirmed closure', async () => {
    const lookupFails = {
      'gh issue view 434 --json state': new Error('exit 1: HTTP 502'),
    };
    const closed = await collectSecurity(
      fakeRun(securityResponses(lookupFails)),
      DATES,
      ACCEPTED,
    );
    expect(closed.failed).toBe(true);
    expect(closed.lines.slice(-3)).toEqual([
      'Could not check: gh issue view 434 --json state: exit 1: HTTP 502',
      'Accepted security findings whose tracking issue closed; each needs a new decision (1):',
      '- #313 (auth_leaked_password_protection)',
    ]);

    const open = await collectSecurity(
      fakeRun(
        securityResponses({
          ...lookupFails,
          'gh issue view 313 --json state': '{"state":"OPEN"}',
        }),
      ),
      DATES,
      ACCEPTED,
    );
    expect(open.lines.slice(-2)).toEqual([
      '- rls_enabled_no_policy_public_gone',
      'Could not check: gh issue view 434 --json state: exit 1: HTTP 502',
    ]);
  });

  it('refuses a full page of drafts instead of undercounting', async () => {
    const page = JSON.stringify(
      Array.from({ length: 30 }, (_, i) => ({
        ghsa_id: `GHSA-${i}`,
        severity: 'low',
        created_at: '2026-11-20T10:00:00Z',
      })),
    );
    const section = await collectSecurity(
      fakeRun(securityResponses({ [ADVISORIES]: page, [SECRETS]: '30' })),
      DATES,
      ACCEPTED,
    );
    expect(section.failed).toBe(true);
    expect(section.lines.slice(0, 2)).toEqual([
      'Could not check: gh api repos/ydafy/Selene-project/security-advisories?state=draft --jq "[.[] | {ghsa_id, severity, created_at}]": the list reached GitHub\'s page size of 30; add --paginate.',
      `Could not check: ${SECRETS}: the list reached GitHub's page size of 30; add --paginate.`,
    ]);
  });

  it('keeps the secret alert check when the advisory list fails', async () => {
    const section = await collectSecurity(
      fakeRun(
        securityResponses({
          [ADVISORIES]: new Error('exit 1: HTTP 404'),
        }),
      ),
      DATES,
      ACCEPTED,
    );
    expect(section.failed).toBe(true);
    expect(section.lines.slice(0, 2)).toEqual([
      'Could not check: gh api repos/ydafy/Selene-project/security-advisories?state=draft --jq "[.[] | {ghsa_id, severity, created_at}]": exit 1: HTTP 404',
      'Open secret scanning alerts: 2.',
    ]);
  });
});

const MAIN_RUNS =
  'gh run list --branch main --created >=2026-11-23 --limit 200 --json databaseId,workflowName,displayTitle,createdAt,conclusion';

function mainRuns(...items: [number, string, string, string, string][]) {
  return JSON.stringify(
    items.map(
      ([databaseId, workflowName, displayTitle, createdAt, conclusion]) => ({
        databaseId,
        workflowName,
        displayTitle,
        createdAt,
        conclusion,
      }),
    ),
  );
}

const PERFORMANCE_FINDINGS = findings(
  ['unused_index', 'INFO', 'unused_index_public_orders_idx_a', 'a'],
  ['unused_index', 'INFO', 'unused_index_public_orders_idx_b', 'b'],
  [
    'multiple_permissive_policies',
    'WARN',
    'multiple_permissive_policies_public_x',
    'Two policies',
  ],
);
const PERFORMANCE_LINES = [
  'Performance advisors: 2 accepted findings unchanged.',
  'Performance findings not accepted (1):',
  '- WARN multiple_permissive_policies_public_x: Two policies',
  'Accepted performance objects no finding reports; remove them from scripts/dev/routine-accepted-findings.ts: none.',
];

describe('collectAppHealth', () => {
  it('lists the failed runs on main, names the later green run that explains one, and compares the performance advisors', async () => {
    const section = await collectAppHealth(
      fakeRun({
        [PERFORMANCE_ADVISORS]: PERFORMANCE_FINDINGS,
        [MAIN_RUNS]: mainRuns(
          [38, 'Release', 'r', '2026-11-28T12:00:00Z', 'cancelled'],
          [37, 'Release', 'r', '2026-11-28T10:00:00Z', 'startup_failure'],
          [36, 'Backup', 'b', '2026-11-27T12:00:00Z', 'timed_out'],
          [35, 'CI', 'chore: z', '2026-11-27T10:00:00Z', ''],
          [34, 'CI', 'fix: x', '2026-11-26T12:00:00Z', 'success'],
          [33, 'CI', 'fix: x', '2026-11-26T10:00:00Z', 'failure'],
          [32, 'Deploy staging', 'feat: y', '2026-11-25T10:00:00Z', 'failure'],
          [31, 'Deploy staging', 'feat: w', '2026-11-24T10:00:00Z', 'success'],
        ),
      }),
      DATES,
      ACCEPTED,
    );
    expect(section.failed).toBe(false);
    expect(section.lines).toEqual([
      'Failed runs on main since 2026-11-23 (4):',
      '- Deploy staging: run 32 failed (2026-11-25T10:00:00Z, "feat: y"); no later run succeeded. Needs a decision; read gh run view 32 --log-failed.',
      '- CI: run 33 failed (2026-11-26T10:00:00Z, "fix: x"); run 34 succeeded later (2026-11-26T12:00:00Z).',
      '- Backup: run 36 failed (2026-11-27T12:00:00Z, "b"); no later run succeeded. Needs a decision; read gh run view 36 --log-failed.',
      '- Release: run 37 failed (2026-11-28T10:00:00Z, "r"); no later run succeeded. Needs a decision; read gh run view 37 --log-failed.',
      ...PERFORMANCE_LINES,
    ]);
  });

  it('refuses a run list that reached its limit, and reports a failed command', async () => {
    const full = mainRuns(
      ...Array.from(
        { length: 200 },
        (_, i): [number, string, string, string, string] => [
          i,
          'CI',
          'x',
          '2026-11-24T10:00:00Z',
          'success',
        ],
      ),
    );
    const limited = await collectAppHealth(
      fakeRun({
        [MAIN_RUNS]: full,
        [PERFORMANCE_ADVISORS]: PERFORMANCE_FINDINGS,
      }),
      DATES,
      ACCEPTED,
    );
    expect(limited.failed).toBe(true);
    expect(limited.lines).toEqual([
      `Could not check: ${MAIN_RUNS}: the list reached its limit of 200; raise --limit.`,
      ...PERFORMANCE_LINES,
    ]);

    const failing = await collectAppHealth(
      fakeRun({
        [MAIN_RUNS]: new Error('exit 1: HTTP 502'),
        [PERFORMANCE_ADVISORS]: new Error('exit 1: Unauthorized'),
      }),
      DATES,
      ACCEPTED,
    );
    expect(failing.lines).toEqual([
      `Could not check: ${MAIN_RUNS}: exit 1: HTTP 502`,
      `Could not check: ${PERFORMANCE_ADVISORS}: exit 1: Unauthorized`,
    ]);
  });
});

const MISTAKES_OF_WEEK =
  'gh issue list --state all --label agent-mistake --search updated:>=2026-11-23 --limit 200 --json number,title,state,createdAt,comments';
const MISTAKES_UNGUARDED =
  'gh issue list --state open --label agent-mistake --search -linked:pr --limit 200 --json number,title,comments';
const TOOLING_NEW =
  'gh issue list --state open --label finding --label area:tooling --search created:>=2026-11-23 --limit 200 --json number,title';
const TOOLING_UNTAKEN =
  'gh issue list --state open --label finding --label area:tooling --search -linked:pr created:<2026-11-16 --limit 200 --json number,title,createdAt';

const comments = (...dates: string[]) =>
  dates.map((createdAt) => ({ body: 'not printed', createdAt }));

function workflowResponses(
  overrides: Record<string, string | Error> = {},
): Record<string, string | Error> {
  return {
    [MISTAKES_OF_WEEK]: JSON.stringify([
      {
        number: 610,
        title: 'Agent skips the guard',
        state: 'OPEN',
        createdAt: '2026-10-01T10:00:00Z',
        comments: comments('2026-10-02T10:00:00Z', '2026-11-25T10:00:00Z'),
      },
      {
        number: 740,
        title: 'Agent edits config',
        state: 'CLOSED',
        createdAt: '2026-11-24T10:00:00Z',
        comments: [],
      },
    ]),
    [MISTAKES_UNGUARDED]: JSON.stringify([
      {
        number: 610,
        title: 'Agent skips the guard',
        comments: comments('2026-10-02T10:00:00Z'),
      },
    ]),
    [TOOLING_NEW]: JSON.stringify([{ number: 745, title: 'Lint misses x' }]),
    [TOOLING_UNTAKEN]: JSON.stringify([
      {
        number: 600,
        title: 'Old tooling bug',
        createdAt: '2026-11-01T10:00:00Z',
      },
    ]),
    ...overrides,
  };
}

describe('collectWorkflow', () => {
  it('classifies the agent mistakes of the week and lists the tooling findings, never comment bodies', async () => {
    const section = await collectWorkflow(fakeRun(workflowResponses()), DATES);
    expect(section.failed).toBe(false);
    expect(section.lines).toEqual([
      'Agent mistakes updated since 2026-11-23 (2):',
      '- #610 Agent skips the guard (open): 1 comment since 2026-11-23',
      '- #740 Agent edits config (closed): first occurrence',
      'Open agent mistakes without a linked PR (1):',
      '- #610 Agent skips the guard (1 comment)',
      'Tooling findings created since 2026-11-23 (1):',
      '- #745 Lint misses x',
      'Tooling findings without a linked PR, created before 2026-11-16 (1):',
      '- #600 Old tooling bug (created 2026-11-01)',
    ]);
  });

  it('does not count the recent comments of an issue whose comment list may be cut', async () => {
    const section = await collectWorkflow(
      fakeRun(
        workflowResponses({
          [MISTAKES_OF_WEEK]: JSON.stringify([
            {
              number: 611,
              title: 'Long thread',
              state: 'OPEN',
              createdAt: '2026-10-01T10:00:00Z',
              comments: comments(
                ...Array.from({ length: 100 }, () => '2026-10-02T10:00:00Z'),
              ),
            },
          ]),
        }),
      ),
      DATES,
    );
    expect(section.failed).toBe(true);
    expect(section.lines.slice(0, 2)).toEqual([
      'Agent mistakes updated since 2026-11-23 (1):',
      '- #611 Long thread (open): Could not check its comments since 2026-11-23: gh returns at most 100 comments; read gh issue view 611 --comments.',
    ]);
  });

  it('keeps the other lists when one fails or reaches its limit', async () => {
    const full = JSON.stringify(
      Array.from({ length: 200 }, (_, i) => ({
        number: i + 1,
        title: 'x',
        comments: [],
      })),
    );
    const section = await collectWorkflow(
      fakeRun(
        workflowResponses({
          [MISTAKES_OF_WEEK]: new Error('exit 1: HTTP 502'),
          [MISTAKES_UNGUARDED]: full,
        }),
      ),
      DATES,
    );
    expect(section.failed).toBe(true);
    expect(section.lines).toEqual([
      `Could not check: ${MISTAKES_OF_WEEK}: exit 1: HTTP 502`,
      `Could not check: ${MISTAKES_UNGUARDED}: the list reached its limit of 200; raise --limit.`,
      'Tooling findings created since 2026-11-23 (1):',
      '- #745 Lint misses x',
      'Tooling findings without a linked PR, created before 2026-11-16 (1):',
      '- #600 Old tooling bug (created 2026-11-01)',
    ]);
  });
});

const TREES = 'C:/dev/School-portal-worktrees';
const git = (path: string, args: string) => `git -C ${path} ${args}`;

function treeResponses(
  path: string,
  status: string,
  ahead: string,
  lastCommit: string,
  diff: string,
): Record<string, string> {
  return {
    [git(path, 'status --porcelain --untracked-files=all')]: status,
    [git(path, 'rev-list --count origin/main..HEAD')]: ahead,
    [git(path, 'log -1 --format=%cI')]: lastCommit,
    [git(path, 'diff --name-only --no-renames origin/main...HEAD')]: diff,
  };
}

function worktreeResponses(
  overrides: Record<string, string | Error> = {},
): Record<string, string | Error> {
  return {
    'git rev-parse --show-toplevel': 'C:/dev/School-portal\n',
    'git worktree list --porcelain': [
      'worktree C:/dev/School-portal\nHEAD 1\nbranch refs/heads/feat/routine-collect',
      `worktree ${TREES}/a\nHEAD 2\nbranch refs/heads/feat/a`,
      `worktree ${TREES}/b\nHEAD 3\nbranch refs/heads/feat/b`,
      'worktree C:/dev/School-portal/.git/gentle-ai/candidate-views/x\nHEAD 4\ndetached',
      `worktree ${TREES}/c\nHEAD 5\nbranch refs/heads/feat/c`,
      `worktree ${TREES}/gone\nHEAD 6\nbranch refs/heads/feat/gone\nprunable gitdir file points to non-existent location`,
      '',
    ].join('\n\n'),
    ...treeResponses(
      `${TREES}/a`,
      // A new manifest in an untracked folder, and a renamed manifest.
      ' M bun.lock\n?? apps/new/package.json\nR  apps/admin-web/package.json -> apps/admin-web/manifest.json\n',
      '2\n',
      '2026-11-29T10:00:00-06:00\n',
      // --no-renames lists a committed rename as its deleted source too.
      'apps/frontend/package.json\npackages/old/package.json\nsrc/x.ts\n',
    ),
    ...treeResponses(`${TREES}/b`, '', '0\n', '2026-11-10T10:00:00Z\n', ''),
    ...treeResponses(`${TREES}/c`, '', '0\n', '2026-11-27T10:00:00Z\n', ''),
    ...overrides,
  };
}

describe('collectWorktrees', () => {
  it('reports the other worktrees, active or not, with the lockfiles they change', async () => {
    const section = await collectWorktrees(fakeRun(worktreeResponses()), DATES);
    expect(section.failed).toBe(false);
    expect(section.lines).toEqual([
      'Active worktrees (2):',
      `- ${TREES}/a (feat/a): 3 uncommitted files, 2 commits ahead of origin/main, last commit 2026-11-29 (1 day ago); lockfiles changed: apps/admin-web/package.json, apps/frontend/package.json, apps/new/package.json, bun.lock, packages/old/package.json`,
      `- ${TREES}/c (feat/c): 0 uncommitted files, 0 commits ahead of origin/main, last commit 2026-11-27 (3 days ago); lockfiles changed: none`,
      'Inactive worktrees (2):',
      `- ${TREES}/b (feat/b): 0 uncommitted files, 0 commits ahead of origin/main, last commit 2026-11-10 (20 days ago)`,
      `- ${TREES}/gone (feat/gone): prunable, its directory is gone`,
    ]);
  });

  it('skips a worktree whose command failed and keeps the others', async () => {
    const section = await collectWorktrees(
      fakeRun(
        worktreeResponses({
          [git(`${TREES}/a`, 'rev-list --count origin/main..HEAD')]: new Error(
            'exit 128: unknown revision origin/main',
          ),
        }),
      ),
      DATES,
    );
    expect(section.failed).toBe(true);
    expect(section.lines).toEqual([
      `Could not check: ${git(`${TREES}/a`, 'rev-list --count origin/main..HEAD')}: exit 128: unknown revision origin/main`,
      'Active worktrees (1):',
      `- ${TREES}/c (feat/c): 0 uncommitted files, 0 commits ahead of origin/main, last commit 2026-11-27 (3 days ago); lockfiles changed: none`,
      'Inactive worktrees (2):',
      `- ${TREES}/b (feat/b): 0 uncommitted files, 0 commits ahead of origin/main, last commit 2026-11-10 (20 days ago)`,
      `- ${TREES}/gone (feat/gone): prunable, its directory is gone`,
    ]);
  });
});

const allResponses = (overrides: Record<string, string | Error> = {}) => ({
  ...dependencyResponses(),
  ...securityResponses(),
  ...backlogResponses(),
  [MAIN_RUNS]: '[]',
  [PERFORMANCE_ADVISORS]: PERFORMANCE_FINDINGS,
  ...workflowResponses(),
  ...worktreeResponses(),
  ...overrides,
});

describe('collectRoutine', () => {
  it('prints the header and every section, and reports whether a check failed', async () => {
    const ok = await collectRoutine(fakeRun(allResponses()), NOW);
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
    expect(
      ok.text.split('\n').filter((line) => line.startsWith('## ')),
    ).toEqual([
      '## A. Dependencies',
      '## B. Security',
      '## C. Backlog',
      '## D. App health',
      '## E. Workflow',
      '## Worktrees',
    ]);
    expect(ok.text).toContain(
      '\n## D. App health\n\nFailed runs on main since 2026-11-23: none.\n',
    );

    const failing = await collectRoutine(
      fakeRun(allResponses({ [SECRETS]: new Error('exit 1') })),
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
