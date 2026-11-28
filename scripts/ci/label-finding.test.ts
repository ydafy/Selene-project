// source-text: reads back the gh calls that the fake gh records and the body skeleton that docs/findings.md tells authors to paste, never source code.
import { afterEach, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'label-finding.sh');
const DOCS = join(import.meta.dir, '..', '..', 'docs', 'findings.md');
const MARKER = '<!-- label-finding:missing-answers -->';
const COMMENTS_QUERY =
  '.comments[] | select(.author.login == env.LABEL_FINDING_BOT_LOGIN) | .body';

// Answers `gh issue view` from fixture files and records `gh issue edit` and
// `gh issue comment` calls (with the comment body read from stdin). For comments it
// accepts only COMMENTS_QUERY and applies it the way gh's jq does: it prints the
// bodies whose author equals $LABEL_FINDING_BOT_LOGIN. A `fail-comments` file makes
// that call fail.
const FAKE_GH = `#!/bin/sh
case "$1 $2" in
  "issue view")
    case "$*" in
      *"--json body"*) cat "$FAKE_GH_DIR/body" ;;
      *"--json labels"*) cat "$FAKE_GH_DIR/labels" ;;
      *"--json comments --jq ${COMMENTS_QUERY}") 
        if [ -e "$FAKE_GH_DIR/fail-comments" ]; then
          echo "fake gh: comments unavailable" >&2; exit 1
        fi
        for author in "$FAKE_GH_DIR"/comments/*.author; do
          [ -e "$author" ] || continue
          if [ "$(cat "$author")" = "\${LABEL_FINDING_BOT_LOGIN:-}" ]; then
            cat "\${author%.author}.body"; echo
          fi
        done ;;
      *) echo "fake gh: unexpected call: $*" >&2; exit 1 ;;
    esac ;;
  "issue edit") echo "gh $*" >> "$FAKE_GH_DIR/calls" ;;
  "issue comment") { echo "gh $*"; cat; echo "[end of body]"; } >> "$FAKE_GH_DIR/calls" ;;
  *) echo "fake gh: unexpected call: $*" >&2; exit 1 ;;
esac
`;

const PRIORITY_OPTIONS = `- Critical (money, data loss, or production broken)
- High (wrong behavior users will hit)
- Medium (edge case or degraded experience)
- Low (cleanup, tooling, docs)`;

const AREA_OPTIONS = `- Payments and payouts
- Orders and shipments
- Mobile app
- Admin web
- Edge Functions
- Database
- Dependencies and tooling
- Docs`;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function formBody(priority: string | null, area: string | null): string {
  const sections = ['### What happens', 'Something breaks.', ''];
  if (priority !== null) sections.push('### Priority', '', priority, '');
  if (area !== null) sections.push('### Area', '', area, '');
  sections.push('### Evidence', '', '_No response_', '');
  return sections.join('\n');
}

type Comment = { author: string; body: string };

function run(
  args: string[],
  fixture: {
    body: string;
    labels?: string[];
    comments?: Comment[];
    failComments?: boolean;
    env?: Record<string, string>;
  },
) {
  const dir = mkdtempSync(join(tmpdir(), 'label-finding-'));
  roots.push(dir);
  const bin = join(dir, 'bin');
  const data = join(dir, 'data');
  for (const path of [bin, data, join(data, 'comments')]) mkdirSync(path);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(data, 'body'), fixture.body);
  writeFileSync(
    join(data, 'labels'),
    (fixture.labels ?? []).map((name) => `${name}\n`).join(''),
  );
  (fixture.comments ?? []).forEach((comment, index) => {
    writeFileSync(join(data, 'comments', `${index}.author`), comment.author);
    writeFileSync(join(data, 'comments', `${index}.body`), comment.body);
  });
  if (fixture.failComments) writeFileSync(join(data, 'fail-comments'), '');

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key.toUpperCase() !== 'PATH') env[key] = value;
  }
  env.PATH = `${bin}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`;
  env.FAKE_GH_DIR = data;
  // If the fake gh were ever bypassed, the real gh fails instead of touching a repository.
  env.GH_REPO = 'selene-test/fake-gh-only';
  env.GH_TOKEN = 'fake-gh-test-token';
  delete env.LABEL_FINDING_BOT_LOGIN;
  Object.assign(env, fixture.env);

  const result = Bun.spawnSync(['bash', SCRIPT, ...args], {
    cwd: dir,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const callsFile = join(data, 'calls');
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    calls: existsSync(callsFile) ? readFileSync(callsFile, 'utf8') : '',
    dir,
  };
}

// The body skeleton from docs/findings.md, "Record a finding".
function docsSkeleton(): string {
  const docs = readFileSync(DOCS, 'utf8').replace(/\r\n/g, '\n');
  const block = /```markdown\n([\s\S]*?)```/.exec(docs);
  if (!block?.[1]) throw new Error('docs/findings.md has no ```markdown block');
  return block[1];
}

const optionLines = (options: string) =>
  options.split('\n').map((line) => line.slice(2));

// The result without the scratch directory, for exact comparison.
const outcome = (result: ReturnType<typeof run>) => ({
  exitCode: result.exitCode,
  stdout: result.stdout,
  stderr: result.stderr,
  calls: result.calls,
});

const MANY_COMMENT = `${MARKER}
The issue labeler could not read every answer it needs from this issue body:

- The \`### Priority\` heading must keep exactly one option.
- The \`### Area\` heading must keep exactly one option.

Under each heading, put one of the lines below exactly as written, then edit the issue. The labeler runs again when the body changes.

\`### Priority\`:

${PRIORITY_OPTIONS}

\`### Area\`:

${AREA_OPTIONS}
[end of body]
`;

describe('label-finding.sh', () => {
  it('sets the priority and area labels from the form and removes stale ones', () => {
    const result = run(['41'], {
      body: formBody('High (wrong behavior users will hit)', 'Database'),
      labels: ['finding', 'priority:low', 'area:docs', 'bug'],
    });

    expect(outcome(result)).toEqual({
      exitCode: 0,
      stdout:
        '#41: priority=priority:high area=area:database add=[priority:high,area:database] remove=[priority:low,area:docs]\n',
      stderr: '',
      calls:
        'gh issue edit 41 --add-label priority:high,area:database --remove-label priority:low,area:docs\n',
    });
  });

  it('syncs the matched group and comments once on a missing heading', () => {
    const result = run(['42'], {
      body: formBody('Medium (edge case or degraded experience)', null),
      labels: ['priority:low'],
    });

    expect(outcome(result)).toEqual({
      exitCode: 0,
      stdout:
        '#42: priority=priority:medium area=unmatched add=[finding,priority:medium] remove=[priority:low]\n' +
        '#42: commented on missing answers\n',
      stderr: '',
      calls:
        'gh issue edit 42 --add-label finding,priority:medium --remove-label priority:low\n' +
        'gh issue comment 42 --body-file -\n' +
        `${MARKER}
The issue labeler could not read every answer it needs from this issue body:

- The \`### Area\` heading is missing.

Under each heading, put one of the lines below exactly as written, then edit the issue. The labeler runs again when the body changes.

\`### Area\`:

${AREA_OPTIONS}
[end of body]
`,
    });
  });

  it('names an unmatched answer and a missing heading in one comment', () => {
    const result = run(['43'], {
      body: formBody('Urgent', null),
      labels: ['finding'],
      comments: [{ author: 'github-actions', body: 'An unrelated comment.' }],
    });

    expect(outcome(result)).toEqual({
      exitCode: 0,
      stdout:
        '#43: priority=unmatched area=unmatched add=[] remove=[]\n' +
        '#43: commented on missing answers\n',
      stderr: '',
      calls:
        'gh issue comment 43 --body-file -\n' +
        `${MARKER}
The issue labeler could not read every answer it needs from this issue body:

- The \`### Priority\` answer is not one of the options.
- The \`### Area\` heading is missing.

Under each heading, put one of the lines below exactly as written, then edit the issue. The labeler runs again when the body changes.

\`### Priority\`:

${PRIORITY_OPTIONS}

\`### Area\`:

${AREA_OPTIONS}
[end of body]
`,
    });
  });

  it('does not comment again when the bot posted the marker comment', () => {
    const result = run(['44'], {
      body: formBody(null, 'Docs'),
      labels: ['finding', 'area:docs'],
      comments: [
        {
          author: 'github-actions',
          body: `${MARKER}\nThe issue labeler could not read every answer.`,
        },
      ],
    });

    expect(outcome(result)).toEqual({
      exitCode: 0,
      stdout:
        '#44: priority=unmatched area=area:docs add=[] remove=[]\n' +
        '#44: missing-answers comment already posted\n',
      stderr: '',
      calls: '',
    });
  });

  it('prints the edit and the comment without making them in dry-run mode', () => {
    const result = run(['--dry-run', '45'], {
      body: formBody('Low (cleanup, tooling, docs)', 'Admin'),
      labels: ['finding', 'priority:high'],
    });

    expect(outcome(result)).toEqual({
      exitCode: 0,
      stdout:
        '#45: priority=priority:low area=unmatched add=[priority:low] remove=[priority:high]\n' +
        '#45: would comment:\n' +
        `${MARKER}
The issue labeler could not read every answer it needs from this issue body:

- The \`### Area\` answer is not one of the options.

Under each heading, put one of the lines below exactly as written, then edit the issue. The labeler runs again when the body changes.

\`### Area\`:

${AREA_OPTIONS}
`,
      stderr: '',
      calls: '',
    });
  });

  it('exits 2 on a non-numeric issue number without calling gh', () => {
    const result = run(['12a'], { body: formBody(null, null) });

    expect(outcome(result)).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: 'issue number must be numeric: 12a\n',
      calls: '',
    });
  });

  it('maps the docs skeleton with one option kept under each heading', () => {
    const dropped = new Set(
      [...optionLines(PRIORITY_OPTIONS), ...optionLines(AREA_OPTIONS)].filter(
        (line) =>
          line !== 'High (wrong behavior users will hit)' &&
          line !== 'Database',
      ),
    );
    const body = docsSkeleton()
      .split('\n')
      .filter((line) => !dropped.has(line))
      .join('\n');

    const result = run(['46'], { body });

    expect(outcome(result)).toEqual({
      exitCode: 0,
      stdout:
        '#46: priority=priority:high area=area:database add=[finding,priority:high,area:database] remove=[]\n',
      stderr: '',
      calls:
        'gh issue edit 46 --add-label finding,priority:high,area:database\n',
    });
  });

  it('comments instead of picking an option when the docs skeleton keeps every option', () => {
    const result = run(['47'], {
      body: docsSkeleton(),
      labels: ['priority:low', 'area:docs'],
    });

    expect(outcome(result)).toEqual({
      exitCode: 0,
      stdout:
        '#47: priority=unmatched area=unmatched add=[finding] remove=[]\n' +
        '#47: commented on missing answers\n',
      stderr: '',
      calls:
        'gh issue edit 47 --add-label finding\n' +
        'gh issue comment 47 --body-file -\n' +
        MANY_COMMENT,
    });
  });

  it('never runs or echoes shell syntax from the body', () => {
    const hostile = [
      '$(touch pwned)',
      '`touch pwned`',
      '@someone',
      '*; touch pwned',
    ];
    const body = [
      '### What happens',
      '',
      ...hostile,
      '',
      '### Priority',
      '',
      '$(touch pwned) `touch pwned`',
      '',
      '### Area',
      '',
      '@someone *; touch pwned',
      '',
    ].join('\n');

    const result = run(['48'], { body, labels: ['finding'] });

    expect(outcome(result)).toEqual({
      exitCode: 0,
      stdout:
        '#48: priority=unmatched area=unmatched add=[] remove=[]\n' +
        '#48: commented on missing answers\n',
      stderr: '',
      calls:
        'gh issue comment 48 --body-file -\n' +
        `${MARKER}
The issue labeler could not read every answer it needs from this issue body:

- The \`### Priority\` answer is not one of the options.
- The \`### Area\` answer is not one of the options.

Under each heading, put one of the lines below exactly as written, then edit the issue. The labeler runs again when the body changes.

\`### Priority\`:

${PRIORITY_OPTIONS}

\`### Area\`:

${AREA_OPTIONS}
[end of body]
`,
    });
    for (const text of ['pwned', '@someone']) {
      expect(result.calls).not.toContain(text);
      expect(result.stdout).not.toContain(text);
    }
    expect(existsSync(join(result.dir, 'pwned'))).toBe(false);
    expect(existsSync(join(result.dir, 'data', 'pwned'))).toBe(false);
  });

  it('ignores a marker comment that the bot did not post', () => {
    const result = run(['49'], {
      body: formBody('Urgent', 'Docs'),
      labels: ['finding', 'area:docs'],
      comments: [{ author: 'someone', body: `${MARKER}\nCopied marker.` }],
    });

    expect(outcome(result)).toEqual({
      exitCode: 0,
      stdout:
        '#49: priority=unmatched area=area:docs add=[] remove=[]\n' +
        '#49: commented on missing answers\n',
      stderr: '',
      calls:
        'gh issue comment 49 --body-file -\n' +
        `${MARKER}
The issue labeler could not read every answer it needs from this issue body:

- The \`### Priority\` answer is not one of the options.

Under each heading, put one of the lines below exactly as written, then edit the issue. The labeler runs again when the body changes.

\`### Priority\`:

${PRIORITY_OPTIONS}
[end of body]
`,
    });
  });

  it('reads the bot login from LABEL_FINDING_BOT_LOGIN', () => {
    const result = run(['50'], {
      body: formBody('Urgent', 'Docs'),
      labels: ['finding', 'area:docs'],
      comments: [{ author: 'selene-bot', body: `${MARKER}\nPosted earlier.` }],
      env: { LABEL_FINDING_BOT_LOGIN: 'selene-bot' },
    });

    expect(outcome(result)).toEqual({
      exitCode: 0,
      stdout:
        '#50: priority=unmatched area=area:docs add=[] remove=[]\n' +
        '#50: missing-answers comment already posted\n',
      stderr: '',
      calls: '',
    });
  });

  it('exits non-zero without commenting when reading the comments fails', () => {
    const result = run(['51'], {
      body: formBody('High (wrong behavior users will hit)', 'Admin'),
      labels: ['finding', 'priority:low'],
      failComments: true,
    });

    // The label edit runs before the comments are read, so it is the only call.
    expect(outcome(result)).toEqual({
      exitCode: 1,
      stdout:
        '#51: priority=priority:high area=unmatched add=[priority:high] remove=[priority:low]\n',
      stderr: 'fake gh: comments unavailable\n',
      calls:
        'gh issue edit 51 --add-label priority:high --remove-label priority:low\n',
    });
  });

  it('maps a body with CRLF line endings', () => {
    const result = run(['52'], {
      body: formBody('Low (cleanup, tooling, docs)', 'Edge Functions').replace(
        /\n/g,
        '\r\n',
      ),
      labels: ['finding'],
    });

    expect(outcome(result)).toEqual({
      exitCode: 0,
      stdout:
        '#52: priority=priority:low area=area:edge-functions add=[priority:low,area:edge-functions] remove=[]\n',
      stderr: '',
      calls: 'gh issue edit 52 --add-label priority:low,area:edge-functions\n',
    });
  });

  it('makes no call when both answers match the labels already present', () => {
    const result = run(['53'], {
      body: formBody(
        'Critical (money, data loss, or production broken)',
        'Mobile app',
      ),
      labels: ['finding', 'priority:critical', 'area:mobile', 'bug'],
    });

    expect(outcome(result)).toEqual({
      exitCode: 0,
      stdout:
        '#53: priority=priority:critical area=area:mobile add=[] remove=[]\n',
      stderr: '',
      calls: '',
    });
  });
});
