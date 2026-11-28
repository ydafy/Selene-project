// source-text: reads back the gh calls that the fake gh records, never source code.
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
const MARKER = '<!-- label-finding:missing-answers -->';

// Answers `gh issue view` from fixture files and records `gh issue edit` and
// `gh issue comment` calls (with the comment body read from stdin).
const FAKE_GH = `#!/bin/sh
case "$1 $2" in
  "issue view")
    case "$*" in
      *"--json body"*) cat "$FAKE_GH_DIR/body" ;;
      *"--json labels"*) cat "$FAKE_GH_DIR/labels" ;;
      *"--json comments"*) cat "$FAKE_GH_DIR/comments" ;;
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

function run(
  args: string[],
  fixture: { body: string; labels?: string[]; comments?: string[] },
) {
  const dir = mkdtempSync(join(tmpdir(), 'label-finding-'));
  roots.push(dir);
  const bin = join(dir, 'bin');
  const data = join(dir, 'data');
  for (const path of [bin, data]) mkdirSync(path);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(data, 'body'), fixture.body);
  writeFileSync(
    join(data, 'labels'),
    (fixture.labels ?? []).map((name) => `${name}\n`).join(''),
  );
  writeFileSync(
    join(data, 'comments'),
    (fixture.comments ?? []).map((body) => `${body}\n`).join(''),
  );

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key.toUpperCase() !== 'PATH') env[key] = value;
  }
  env.PATH = `${bin}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`;
  env.FAKE_GH_DIR = data;
  // If the fake gh were ever bypassed, the real gh fails instead of touching a repository.
  env.GH_REPO = 'selene-test/fake-gh-only';
  env.GH_TOKEN = 'fake-gh-test-token';

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
  };
}

describe('label-finding.sh', () => {
  it('sets the priority and area labels from the form and removes stale ones', () => {
    const result = run(['41'], {
      body: formBody('High (wrong behavior users will hit)', 'Database'),
      labels: ['finding', 'priority:low', 'area:docs', 'bug'],
    });

    expect(result).toEqual({
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

    expect(result).toEqual({
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
      comments: ['An unrelated comment.'],
    });

    expect(result).toEqual({
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

  it('does not comment again when the marker comment exists', () => {
    const result = run(['44'], {
      body: formBody(null, 'Docs'),
      labels: ['finding', 'area:docs'],
      comments: [`${MARKER}\nThe issue labeler could not read every answer.`],
    });

    expect(result).toEqual({
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

    expect(result).toEqual({
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

    expect(result).toEqual({
      exitCode: 2,
      stdout: '',
      stderr: 'issue number must be numeric: 12a\n',
      calls: '',
    });
  });
});
