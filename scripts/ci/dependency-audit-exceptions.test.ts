import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseAuditIgnores } from './dependency-report';

const root = join(import.meta.dir, '..', '..');
const workflow = readFileSync(
  join(root, '.github/workflows/dependency-audit.yml'),
  'utf8',
);

// The weekly audit fails on high and critical advisories. An accepted exception
// is an `--ignore` with its reason written in the workflow (docs/dependencies.md,
// "An override would be unsafe"). bun ignores a GHSA for every copy of the
// package, so each new exception also gets its own guard test here that limits
// what it hides.
describe('dependency audit exceptions', () => {
  it('audits at the high level', () => {
    expect(workflow).toMatch(/bun audit --audit-level=high/);
  });

  it('gives every --ignore its reason in a workflow comment', () => {
    const comments = workflow
      .split(/\r?\n/)
      .filter((line) => line.trimStart().startsWith('#'))
      .join('\n');
    for (const id of parseAuditIgnores(workflow)) {
      expect({ id, reason: comments.includes(id) }).toEqual({
        id,
        reason: true,
      });
    }
  });
});
