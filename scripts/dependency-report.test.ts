import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildDependencyReport,
  changelogUrl,
  expoSdkStatus,
  parseAudit,
  parseAuditIgnores,
  parseExpoCheck,
  parseExpoRegistry,
  parseOutdated,
  runReport,
  type Collectors,
  type ReportInput,
} from './dependency-report.ts';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, 'fixtures', 'dependency-report', name), {
    encoding: 'utf8',
  });
const workflow = readFileSync(
  join(import.meta.dir, '..', '.github', 'workflows', 'dependency-audit.yml'),
  { encoding: 'utf8' },
);

const NOW = new Date('2026-10-29T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * DAY).toISOString();

describe('parseOutdated', () => {
  test('reads the table of a filtered workspace and strips the star markers', () => {
    const rows = parseOutdated(fixture('outdated-frontend.stdout'), 'ignored');
    const query = rows.find((row) => row.name === '@tanstack/react-query');
    expect(query).toEqual({
      name: '@tanstack/react-query',
      workspace: '@selene/frontend',
      dev: false,
      current: '5.104.5',
      update: '5.105.0',
      latest: '5.105.0',
    });
    expect(rows.find((row) => row.name === 'expo')?.latest).toBe('58.0.19');
    expect(rows.every((row) => !row.latest.includes('*'))).toBe(true);
  });

  test('marks dev dependencies and drops the (dev) suffix from the name', () => {
    const rows = parseOutdated(fixture('outdated-admin-web.stdout'), 'ignored');
    expect(rows.find((row) => row.name === '@eslint/js')).toMatchObject({
      dev: true,
      workspace: 'admin-web',
      current: '9.39.5',
      latest: '10.0.1',
    });
  });

  test('uses the given workspace name for the root table, which has no workspace column', () => {
    const rows = parseOutdated(fixture('outdated-root.stdout'), 'root');
    expect(rows.find((row) => row.name === 'eslint')).toMatchObject({
      workspace: 'root',
      dev: true,
      update: '9.39.5',
      latest: '10.13.0',
    });
  });

  test('returns no rows when bun prints no table', () => {
    expect(parseOutdated('bun outdated v1.4.2 (744846f84)\n', 'root')).toEqual(
      [],
    );
  });
});

describe('parseExpoCheck', () => {
  test('returns no mismatches when the output has the env preamble and says up to date', () => {
    expect(parseExpoCheck(fixture('expo-check.stdout'))).toEqual([]);
  });

  test('lists the packages that do not match the SDK', () => {
    expect(parseExpoCheck(fixture('expo-check-mismatch.stdout'))).toEqual([
      { name: 'expo-image', actual: '57.0.2', expected: '~57.0.5' },
      { name: 'react-native-screens', actual: '4.25.0', expected: '~4.26.2' },
    ]);
  });

  test('throws when the output has no JSON', () => {
    expect(() => parseExpoCheck('boom')).toThrow();
  });
});

describe('parseAuditIgnores', () => {
  test('reads the --ignore flags of the real workflow file', () => {
    expect(parseAuditIgnores(workflow)).toEqual([
      'GHSA-86w9-cpqp-85rv',
      'GHSA-mrhx-c7xc-m3w5',
      'GHSA-qr28-fpjm-wq7f',
    ]);
  });

  test('ignores flags mentioned in comments', () => {
    expect(
      parseAuditIgnores(
        '# drop each --ignore=GHSA-x once fixed\n- run: bun audit',
      ),
    ).toEqual([]);
  });
});

describe('parseAudit', () => {
  const ignores = parseAuditIgnores(workflow);

  test('keeps only high and critical advisories that are not ignored', () => {
    expect(parseAudit(fixture('audit.json'), ignores).findings).toEqual([]);
  });

  test('reports a high advisory when its id is not in the ignore list', () => {
    const { findings } = parseAudit(fixture('audit.json'), [
      'GHSA-86w9-cpqp-85rv',
    ]);
    expect(findings.map((finding) => finding.id)).toEqual([
      'GHSA-qr28-fpjm-wq7f',
      'GHSA-mrhx-c7xc-m3w5',
    ]);
    expect(findings[0]).toMatchObject({
      name: 'decode-uri-component',
      severity: 'high',
      vulnerable: '<=0.5.0',
    });
  });

  test('describes the accepted exceptions with the package that carries them', () => {
    const { exceptions } = parseAudit(fixture('audit.json'), ignores);
    expect(exceptions).toContainEqual({
      id: 'GHSA-86w9-cpqp-85rv',
      name: 'node-forge',
      title: expect.stringContaining('node-forge'),
    });
  });

  test('treats an empty object as no advisories', () => {
    expect(parseAudit('{}', ignores)).toEqual({
      findings: [],
      exceptions: ignores.map((id) => ({ id })),
    });
  });
});

describe('parseExpoRegistry', () => {
  test('takes the SDK release date from the first version of the latest major', () => {
    expect(parseExpoRegistry(fixture('registry-expo.json'))).toEqual({
      version: '58.0.21',
      releasedAt: '2026-09-29T15:17:26.858Z',
    });
  });
});

describe('changelogUrl', () => {
  test('links the GitHub releases page for the usual repository url shapes', () => {
    for (const url of [
      'git+https://github.com/lucide-icons/lucide.git',
      'git://github.com/lucide-icons/lucide.git',
      'git@github.com:lucide-icons/lucide.git',
      'github:lucide-icons/lucide',
      'https://github.com/lucide-icons/lucide',
    ]) {
      expect(changelogUrl('lucide-react', url)).toBe(
        'https://github.com/lucide-icons/lucide/releases',
      );
    }
  });

  test('falls back to the npm page when the repository is not on GitHub or unknown', () => {
    const npm = 'https://www.npmjs.com/package/@scope/pkg';
    expect(changelogUrl('@scope/pkg', 'https://gitlab.com/a/b.git')).toBe(npm);
    expect(changelogUrl('@scope/pkg', undefined)).toBe(npm);
  });
});

describe('expoSdkStatus', () => {
  const status = (days: number, installed = '57.0.31', latest = '58.0.21') =>
    expoSdkStatus(installed, latest, daysAgo(days), NOW);

  test('waits until the new SDK is 30 days old', () => {
    expect(status(29)).toEqual({ kind: 'wait', ageDays: 29 });
  });

  test('recommends the upgrade at exactly 30 days and after', () => {
    expect(status(30)).toEqual({ kind: 'upgrade', ageDays: 30 });
    expect(status(31)).toEqual({ kind: 'upgrade', ageDays: 31 });
  });

  test('is up to date when the latest major equals the installed one', () => {
    expect(status(90, '58.0.3', '58.0.21')).toEqual({
      kind: 'current',
      ageDays: 90,
    });
  });
});

function baseInput(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    outdated: {
      ok: true,
      value: [
        ...parseOutdated(fixture('outdated-frontend.stdout'), 'x'),
        ...parseOutdated(fixture('outdated-admin-web.stdout'), 'x'),
        ...parseOutdated(fixture('outdated-root.stdout'), 'root'),
      ],
    },
    expoCheck: { ok: true, value: [] },
    audit: {
      ok: true,
      value: parseAudit(fixture('audit.json'), parseAuditIgnores(workflow)),
    },
    expo: {
      ok: true,
      value: {
        installed: '57.0.31',
        latest: parseExpoRegistry(fixture('registry-expo.json')),
      },
    },
    repositories: {
      ok: true,
      value: {
        '@tanstack/react-table': 'git+https://github.com/TanStack/table.git',
        'lucide-react': 'git+https://github.com/lucide-icons/lucide.git',
        'react-native-gesture-handler': 'https://gitlab.com/x/y.git',
      },
    },
    ...overrides,
  };
}

function section(report: string, title: string): string {
  const start = report.indexOf(`## ${title}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = report.indexOf('\n## ', start + 1);
  return report.slice(start, next === -1 ? undefined : next);
}

describe('buildDependencyReport', () => {
  test('is deterministic and dated with the given now', () => {
    const first = buildDependencyReport(baseInput(), NOW);
    expect(buildDependencyReport(baseInput(), NOW)).toBe(first);
    expect(first).toContain('2026-10-29');
    expect(first).toContain('docs/dependencies.md');
  });

  test('lists in-range updates sorted by package name', () => {
    const safe = section(
      buildDependencyReport(baseInput(), NOW),
      'Safe updates (patch and minor)',
    );
    expect(safe).toContain(
      '| @tanstack/react-query | @selene/frontend | 5.104.5 | 5.105.0 |',
    );
    expect(safe).toContain('| eslint-plugin-prettier | root | 5.5.6 | 5.5.7 |');
    const names = [...safe.matchAll(/^\| ([^ |]+) \|/gm)]
      .map((match) => match[1])
      .filter((name) => name !== 'Package' && !name.startsWith('-'));
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  test('moves Expo-pinned packages out of safe updates into the Expo section', () => {
    const input = baseInput({
      outdated: {
        ok: true,
        value: [
          {
            name: 'expo-image',
            workspace: '@selene/frontend',
            dev: false,
            current: '57.0.2',
            update: '57.0.5',
            latest: '58.0.17',
          },
          {
            name: 'i18next',
            workspace: '@selene/frontend',
            dev: false,
            current: '26.5.4',
            update: '26.5.11',
            latest: '26.5.11',
          },
        ],
      },
      expoCheck: {
        ok: true,
        value: [{ name: 'expo-image', actual: '57.0.2', expected: '~57.0.5' }],
      },
    });
    const report = buildDependencyReport(input, NOW);
    expect(section(report, 'Safe updates (patch and minor)')).not.toContain(
      'expo-image',
    );
    expect(section(report, 'Safe updates (patch and minor)')).toContain(
      'i18next',
    );
    expect(section(report, 'Majors available')).not.toContain('expo-image');
    const expo = section(report, 'Expo');
    expect(expo).toContain('expo-image');
    expect(expo).toContain('~57.0.5');
    expect(expo).toContain('npx expo install --fix');
  });

  test('lists majors with changelog links and the one-per-commit note', () => {
    const majors = section(
      buildDependencyReport(baseInput(), NOW),
      'Majors available',
    );
    expect(majors).toContain('one major per commit');
    expect(majors).toContain('docs/dependencies.md');
    expect(majors).toContain(
      '| lucide-react | admin-web | 0.577.0 | 1.61.0 | https://github.com/lucide-icons/lucide/releases |',
    );
    expect(majors).toContain('https://github.com/TanStack/table/releases');
    expect(majors).toContain(
      'https://www.npmjs.com/package/react-native-gesture-handler',
    );
    expect(majors).toContain(
      'https://www.npmjs.com/package/@stripe/stripe-react-native',
    );
  });

  test('moves held-back majors to their own list with the reason', () => {
    const report = buildDependencyReport(baseInput(), NOW);
    const majors = section(report, 'Majors available');
    expect(majors).not.toContain('| typescript |');
    const held = section(report, 'Held back on purpose');
    expect(held).toContain('| typescript | 6.0.3 | 7.0.2 |');
    expect(held).toContain('typescript-eslint');
    expect(held).toContain('docs/dependencies.md');
  });

  test('treats a minor of a 0.x package as a major', () => {
    const report = buildDependencyReport(
      baseInput({
        outdated: {
          ok: true,
          value: [
            {
              name: 'zero',
              workspace: 'root',
              dev: false,
              current: '0.4.1',
              update: '0.4.1',
              latest: '0.5.0',
            },
          ],
        },
      }),
      NOW,
    );
    expect(section(report, 'Majors available')).toContain(
      '| zero | root | 0.4.1 | 0.5.0 |',
    );
  });

  test('applies the 30 day Expo rule', () => {
    const expoAt = (days: number, installed = '57.0.31') =>
      section(
        buildDependencyReport(
          baseInput({
            expo: {
              ok: true,
              value: {
                installed,
                latest: { version: '58.0.21', releasedAt: daysAgo(days) },
              },
            },
          }),
          NOW,
        ),
        'Expo',
      );
    expect(expoAt(29)).toContain('New SDK too recent (29 days, wait until 30)');
    expect(expoAt(29)).not.toContain('Upgrade recommended');
    expect(expoAt(30)).toContain('Upgrade recommended');
    expect(expoAt(31)).toContain('Upgrade recommended');
    expect(expoAt(31, '58.0.3')).toContain('Up to date');
  });

  test('shows the vulnerability table and accepted exceptions', () => {
    const noIgnore = parseAudit(fixture('audit.json'), ['GHSA-86w9-cpqp-85rv']);
    const security = section(
      buildDependencyReport(
        baseInput({ audit: { ok: true, value: noIgnore } }),
        NOW,
      ),
      'Security (bun audit)',
    );
    expect(security).toContain(
      '| decode-uri-component | GHSA-qr28-fpjm-wq7f | high |',
    );
    expect(security).toContain('GHSA-86w9-cpqp-85rv');
  });

  test('says nothing to update and no vulnerabilities for empty inputs', () => {
    const report = buildDependencyReport(
      baseInput({
        outdated: { ok: true, value: [] },
        audit: { ok: true, value: { findings: [], exceptions: [] } },
      }),
      NOW,
    );
    expect(section(report, 'Safe updates (patch and minor)')).toContain(
      'Nothing to update',
    );
    expect(section(report, 'Majors available')).toContain('Nothing to update');
    expect(section(report, 'Security (bun audit)')).toContain(
      'No high or critical vulnerabilities',
    );
  });

  test('renders "Could not check" for a failed collector without hiding the others', () => {
    const report = buildDependencyReport(
      baseInput({ audit: { ok: false, error: 'bun audit timed out' } }),
      NOW,
    );
    expect(section(report, 'Security (bun audit)')).toContain(
      'Could not check: bun audit timed out',
    );
    expect(section(report, 'Safe updates (patch and minor)')).toContain(
      '@tanstack/react-query',
    );
  });
});

describe('runReport', () => {
  const collectors = (overrides: Partial<Collectors> = {}): Collectors => ({
    outdated: async () => [
      {
        workspace: '@selene/frontend',
        text: fixture('outdated-frontend.stdout'),
      },
      { workspace: 'admin-web', text: fixture('outdated-admin-web.stdout') },
      { workspace: 'root', text: fixture('outdated-root.stdout') },
    ],
    expoCheck: async () => fixture('expo-check.stdout'),
    audit: async () => ({ json: fixture('audit.json'), workflow }),
    expoRegistry: async () => fixture('registry-expo.json'),
    installedExpo: async () => '57.0.31',
    repositories: async () => ({}),
    ...overrides,
  });

  test('exits 0 even though updates exist', async () => {
    // 30 days and a few hours after the 58.0.0 release in the registry fixture.
    const result = await runReport(
      collectors(),
      new Date('2026-10-30T00:00:00.000Z'),
    );
    expect(result.exitCode).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.markdown).toContain('Upgrade recommended');
  });

  test('exits 1 and keeps the other sections when a collector fails', async () => {
    const result = await runReport(
      collectors({
        expoCheck: async () => {
          throw new Error('network down');
        },
      }),
      NOW,
    );
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual(['expo install --check: network down']);
    expect(result.markdown).toContain('Could not check: network down');
    expect(result.markdown).toContain('@tanstack/react-query');
    expect(result.markdown).toContain('No high or critical vulnerabilities');
  });
});
