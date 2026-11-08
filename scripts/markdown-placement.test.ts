import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

import { listRepoFiles } from './agent-instructions';
import { findMisplacedMarkdown } from './markdown-placement';

const root = join(import.meta.dir, '..');

describe('Markdown placement (probes)', () => {
  it('reports Markdown next to code', () => {
    expect(
      findMisplacedMarkdown([
        'supabase/queries/payments/probe_deployment.md',
        'apps/admin-web/docs/probe.md',
        'supabase/functions/probe/DEPLOYED_HARNESS.md',
        'NOTES.md',
      ]),
    ).toEqual([
      'supabase/queries/payments/probe_deployment.md',
      'apps/admin-web/docs/probe.md',
      'supabase/functions/probe/DEPLOYED_HARNESS.md',
      'NOTES.md',
    ]);
  });

  it('accepts the Markdown homes and leaves other files alone', () => {
    expect(
      findMisplacedMarkdown([
        'docs/runbooks/probe.md',
        'odd/tasks/probe.md',
        'design/probe/brief.md',
        '.agents/skills/probe/SKILL.md',
        '.github/pull_request_template.md',
        'supabase/functions/AGENTS.md',
        'supabase/migrations/archive/README.md',
        'DESIGN.md',
        'SECURITY.md',
        'supabase/queries/payments/probe.sql',
      ]),
    ).toEqual([]);
  });

  it('accepts DESIGN.md and SECURITY.md only at the root', () => {
    expect(
      findMisplacedMarkdown([
        'apps/admin-web/DESIGN.md',
        'docs-old/SECURITY.md',
      ]),
    ).toEqual(['apps/admin-web/DESIGN.md', 'docs-old/SECURITY.md']);
  });
});

describe('Markdown placement (repository)', () => {
  it('keeps every Markdown file in a Markdown home', () => {
    expect(findMisplacedMarkdown(listRepoFiles(root))).toEqual([]);
  });
});
