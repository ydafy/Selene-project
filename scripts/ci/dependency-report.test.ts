import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  actionStatus,
  buildDependencyReport,
  bunRuntimeStatus,
  changelogUrl,
  expoSdkStatus,
  parseAudit,
  parseAuditIgnores,
  parseBunRegistry,
  parseCommitSha,
  parseExpoCheck,
  parseLatestRelease,
  parseExpoPins,
  nodeRuntimeStatus,
  parseExpoRegistry,
  parseNodeReleases,
  parseNodeSchedule,
  parseOutdated,
  parseStripeApi,
  parseSupabaseCliPin,
  runReport,
  stripeApiStatus,
  supabaseCliStatus,
  type ActionRow,
  type Collectors,
  type ReportInput,
} from './dependency-report.ts';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, 'fixtures', 'dependency-report', name), {
    encoding: 'utf8',
  });
// A frozen audit workflow with two exceptions; the real one has none today.
const workflow = fixture('dependency-audit.yml');

const NOW = new Date('2026-10-29T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * DAY).toISOString();

describe('parseOutdated', () => {
  test('rejects a table it does not recognize instead of reporting nothing', () => {
    expect(() =>
      parseOutdated('| Name | From | To |\n| a | 1.0.0 | 2.0.0 |', 'root'),
    ).toThrow('unrecognized `bun outdated` output');
    expect(() =>
      parseOutdated('| Package | Current | Version |\n| a | 1 | 2 |', 'root'),
    ).toThrow('unrecognized `bun outdated` output');
  });

  test('treats output without a table as nothing outdated', () => {
    expect(parseOutdated('bun outdated v1.4.2\n', 'root')).toEqual([]);
  });

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

describe('parseExpoPins', () => {
  test('lists the package names the installed SDK pins', () => {
    const pins = parseExpoPins(fixture('expo-pins.json'));
    expect(pins).toContain('react-native-gesture-handler');
    expect(pins).toContain('@stripe/stripe-react-native');
    expect(pins).toHaveLength(11);
  });

  test('throws on output that is not a pin list', () => {
    expect(() => parseExpoPins('boom')).toThrow();
    expect(() => parseExpoPins('[]')).toThrow();
    expect(() => parseExpoPins('{}')).toThrow();
  });
});

describe('parseAuditIgnores', () => {
  test('reads the --ignore flags of an audit workflow', () => {
    expect(parseAuditIgnores(workflow)).toEqual([
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
      id: 'GHSA-mrhx-c7xc-m3w5',
      name: 'zod',
      title: expect.stringContaining('Zod'),
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

// Trimmed copies of https://nodejs.org/dist/index.json, the Node release
// schedule, and the npm registry entry for bun.
const NODE_INDEX = JSON.stringify([
  {
    version: 'v26.13.0',
    date: '2026-10-28',
    npm: '11.6.0',
    lts: 'Lithium',
    security: false,
  },
  { version: 'v25.9.0', date: '2026-03-31', lts: false, security: false },
  { version: 'v24.23.0', date: '2026-10-27', lts: 'Krypton', security: true },
  { version: 'v24.22.3', date: '2026-10-01', lts: 'Krypton', security: false },
  { version: 'v24.22.2', date: '2026-09-01', lts: 'Krypton', security: false },
  { version: 'v22.23.4', date: '2026-10-20', lts: 'Jod', security: true },
]);
const NODE_SCHEDULE = JSON.stringify({
  'v0.10': { start: '2013-03-11', end: '2016-10-31' },
  v22: {
    start: '2024-04-24',
    lts: '2024-10-29',
    maintenance: '2025-10-21',
    end: '2027-04-30',
    codename: 'Jod',
  },
  v24: {
    start: '2025-05-06',
    lts: '2025-10-28',
    maintenance: '2026-10-20',
    end: '2028-04-30',
    codename: 'Krypton',
  },
  v25: { start: '2025-10-15', maintenance: '2026-04-01', end: '2026-06-01' },
  v26: {
    start: '2026-05-05',
    lts: '2026-10-28',
    maintenance: '2027-10-20',
    end: '2029-04-30',
    codename: 'Lithium',
  },
});
const BUN_REGISTRY = JSON.stringify({
  'dist-tags': { latest: '1.4.4' },
  time: {
    '1.4.2': '2026-09-05T06:01:35.854Z',
    '1.4.4': '2026-10-22T10:19:13.548Z',
  },
});
const nodeData = {
  releases: parseNodeReleases(NODE_INDEX),
  schedule: parseNodeSchedule(NODE_SCHEDULE),
};

const SUPABASE_CLI_REGISTRY = JSON.stringify({
  'dist-tags': { latest: '3.0.0' },
  time: {
    '2.122.0': '2026-10-20T00:00:00.000Z',
    '3.0.0': '2026-10-21T00:00:00.000Z',
  },
});
const SETUP_CLI_STEP =
  '      - uses: supabase/setup-cli@1111111111111111111111111111111111111111 # v3.0.1\n        with:\n          version: 2.122.0\n';
// Trimmed copies of the shared api-version.ts, the root package.json, and the
// installed stripe package's esm/apiVersion.js and package.json.
const stripeFiles = (
  overrides: Partial<{
    apiVersion: string;
    packageJson: string;
    sdkApiVersion: string;
    sdkPackageJson: string;
  }> = {},
) => ({
  apiVersion:
    "import type Stripe from './sdk.ts';\n\n// The API version every Stripe client sends.\nexport const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-10-28.endive';\n",
  packageJson: JSON.stringify({ devDependencies: { stripe: '23.1.0' } }),
  sdkApiVersion:
    "// File generated from our OpenAPI spec\nexport const ApiVersion = '2026-10-28.endive';\nexport const ApiMajorVersion = 'endive';\n",
  sdkPackageJson: JSON.stringify({ name: 'stripe', version: '23.1.0' }),
  ...overrides,
});
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const actionRow = (overrides: Partial<ActionRow> = {}): ActionRow => ({
  action: 'actions/checkout',
  pinnedSha: SHA_A,
  pinnedTag: 'v4.4.0',
  resolvedSha: SHA_A,
  latest: { tag: 'v4.4.0', publishedAt: '2026-05-01T00:00:00Z' },
  ...overrides,
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
    pins: { ok: true, value: parseExpoPins(fixture('expo-pins.json')) },
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
    runtimes: {
      ok: true,
      value: {
        pins: { node: '24.23.0', bun: '1.4.4' },
        ...nodeData,
        bun: parseBunRegistry(BUN_REGISTRY),
      },
    },
    supabaseCli: {
      ok: true,
      value: {
        pinned: '3.0.0',
        latest: { version: '3.0.0', releasedAt: '2026-10-21T00:00:00.000Z' },
      },
    },
    stripeApi: { ok: true, value: parseStripeApi(stripeFiles()) },
    actions: { ok: true, value: [actionRow()] },
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

  // .github/workflows/dependency-report.yml comments line 3 as the weekly summary.
  test('puts the one-line summary on line 3', () => {
    const lines = buildDependencyReport(baseInput(), NOW).split('\n');
    expect(lines[0]).toBe('# Dependency report, 2026-10-29');
    expect(lines[1]).toBe('');
    expect(lines[2]).toMatch(/^\d+ safe updates, \d+ majors, .+\.$/);
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
    expect(majors).toContain('https://www.npmjs.com/package/@eslint/js');
  });

  const row = (
    name: string,
    workspace: string,
    current: string,
    update: string,
    latest: string,
  ) => ({ name, workspace, dev: false, current, update, latest });

  test('keeps pinned packages with a newer major out of safe updates and majors, and shows them in the Expo section', () => {
    const report = buildDependencyReport(
      baseInput({
        outdated: {
          ok: true,
          value: [
            row(
              'react-native-gesture-handler',
              '@selene/frontend',
              '2.32.0',
              '2.32.0',
              '3.4.0',
            ),
            row(
              'react-native-webview',
              '@selene/frontend',
              '13.16.1',
              '13.16.2',
              '14.0.1',
            ),
            row('left-pad', '@selene/frontend', '1.0.0', '1.0.0', '2.0.0'),
          ],
        },
      }),
      NOW,
    );
    for (const title of [
      'Safe updates (patch and minor)',
      'Majors available',
    ]) {
      expect(section(report, title)).not.toContain(
        'react-native-gesture-handler',
      );
      expect(section(report, title)).not.toContain('react-native-webview');
    }
    const expo = section(report, 'Expo');
    expect(expo).toContain('| react-native-gesture-handler | 2.32.0 | 3.4.0 |');
    expect(expo).toContain('| react-native-webview | 13.16.1 | 14.0.1 |');
    expect(expo).toContain('SDK upgrade');
    expect(section(report, 'Majors available')).toContain('| left-pad |');
    expect(report.split(/\r?\n/)[2]).toMatch(/^0 safe updates, 1 majors, /);
  });

  test('still lists a pinned package of another workspace as a major', () => {
    const majors = section(
      buildDependencyReport(
        baseInput({
          outdated: {
            ok: true,
            value: [
              row(
                'react-native-gesture-handler',
                'admin-web',
                '2.0.0',
                '2.0.0',
                '3.0.0',
              ),
            ],
          },
        }),
        NOW,
      ),
      'Majors available',
    );
    expect(majors).toContain('| react-native-gesture-handler | admin-web |');
  });

  test('withholds app packages from the update lists when the pin list could not be read', () => {
    const report = buildDependencyReport(
      baseInput({
        pins: { ok: false, error: 'pin list missing' },
        outdated: {
          ok: true,
          value: [
            row(
              'react-native-gesture-handler',
              '@selene/frontend',
              '2.32.0',
              '2.32.0',
              '3.4.0',
            ),
            row(
              'expo-image',
              '@selene/frontend',
              '57.0.5',
              '57.0.5',
              '58.0.17',
            ),
            row('lucide-react', 'admin-web', '0.577.0', '0.577.0', '1.61.0'),
          ],
        },
      }),
      NOW,
    );
    const majors = section(report, 'Majors available');
    expect(majors).not.toContain('react-native-gesture-handler');
    expect(majors).toContain('| lucide-react | admin-web |');
    expect(majors).toContain('could not be classified');
    expect(majors).toContain('Could not check: pin list missing');
    expect(report.split(/\r?\n/)[2]).toMatch(/^0 safe updates, 1 majors, /);
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

  describe('@types/node follows the pinned Node line', () => {
    const typesNode = {
      name: '@types/node',
      workspace: 'root',
      dev: true,
      current: '24.19.2',
      update: '24.19.2',
      latest: '26.6.6',
    };
    const withNode = (node: string) =>
      buildDependencyReport(
        baseInput({
          outdated: { ok: true, value: [typesNode] },
          runtimes: {
            ok: true,
            value: {
              pins: { node, bun: '1.4.4' },
              ...nodeData,
              bun: parseBunRegistry(BUN_REGISTRY),
            },
          },
        }),
        NOW,
      );

    test('holds a major above the pinned Node major', () => {
      const report = withNode('24.23.0');
      expect(section(report, 'Majors available')).not.toContain('@types/node');
      const held = section(report, 'Held back on purpose');
      expect(held).toContain('| @types/node | 24.19.2 | 26.6.6 |');
      expect(held).toContain('.nvmrc 24');
    });

    test('lists the major once .nvmrc reaches that Node major', () => {
      const report = withNode('26.1.0');
      expect(section(report, 'Majors available')).toContain(
        '| @types/node | root | 24.19.2 | 26.6.6 |',
      );
      expect(report).not.toContain('Held back on purpose');
    });
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
    expoPins: async () => fixture('expo-pins.json'),
    audit: async () => ({ json: fixture('audit.json'), workflow }),
    expoRegistry: async () => fixture('registry-expo.json'),
    installedExpo: async () => '57.0.31',
    repositories: async () => ({}),
    nodeReleases: async () => NODE_INDEX,
    nodeSchedule: async () => NODE_SCHEDULE,
    bunRegistry: async () => BUN_REGISTRY,
    runtimePins: async () => ({
      nvmrc: '24.22.2\n',
      packageManager: 'bun@1.4.2',
    }),
    supabaseCliRegistry: async () => SUPABASE_CLI_REGISTRY,
    stripeApi: async () => stripeFiles(),
    workflows: async () => [
      `steps:\n  - uses: actions/checkout@${SHA_A} # v4.4.0\n  - uses: actions/checkout@${SHA_A} # v4.4.0\n`,
      `steps:\n${SETUP_CLI_STEP}`,
    ],
    githubApi: async (path) =>
      path.endsWith('/releases/latest')
        ? JSON.stringify({
            tag_name: 'v7.0.1',
            published_at: '2026-10-01T00:00:00Z',
          })
        : JSON.stringify({ sha: SHA_A }),
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

  test('exits 1 and does not list app packages as majors when the pin list fails', async () => {
    const result = await runReport(
      collectors({
        expoPins: async () => {
          throw new Error('no bundledNativeModules.json');
        },
      }),
      NOW,
    );
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual(['expo pins: no bundledNativeModules.json']);
    expect(result.markdown).toContain(
      'Could not check: no bundledNativeModules.json',
    );
    const majors = section(result.markdown, 'Majors available');
    expect(majors).not.toContain('react-native-gesture-handler');
    expect(majors).not.toContain('@shopify/flash-list');
    expect(majors).toContain('| lucide-react | admin-web |');
  });

  test('looks up changelogs only for packages the report lists as majors', async () => {
    let asked: string[] = [];
    await runReport(
      collectors({
        repositories: async (names) => {
          asked = names;
          return {};
        },
      }),
      NOW,
    );
    expect(asked).not.toContain('react-native-gesture-handler');
    expect(asked).toContain('lucide-react');
  });

  test('reads the runtime pins from .nvmrc and packageManager', async () => {
    const result = await runReport(collectors(), NOW);
    expect(result.errors).toEqual([]);
    const runtimes = section(result.markdown, 'Runtimes');
    expect(runtimes).toContain('| Node | 24.22.2 | 24.23.0 |');
    expect(runtimes).toContain('| Bun | 1.4.2 | 1.4.4 |');
  });

  test('exits 1 when a runtime source cannot be read', async () => {
    const result = await runReport(
      collectors({
        nodeSchedule: async () => {
          throw new Error('github answered 500');
        },
      }),
      NOW,
    );
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual(['runtimes: github answered 500']);
    expect(result.markdown).toContain('Could not check: github answered 500');
    expect(result.markdown).toContain('No high or critical vulnerabilities');
  });

  test('exits 1 when .nvmrc pins a Node line the schedule does not know', async () => {
    const result = await runReport(
      collectors({
        runtimePins: async () => ({
          nvmrc: '23.1.0\n',
          packageManager: 'bun@1.4.4',
        }),
      }),
      NOW,
    );
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      'runtimes: Node 23 is not in the release schedule',
    ]);
    expect(result.markdown).toContain(
      'Could not check: Node 23 is not in the release schedule',
    );
  });

  test('lists each action once and exits 1 when the GitHub API fails', async () => {
    const calls: string[] = [];
    const ok = await runReport(
      collectors({
        githubApi: async (path) => {
          calls.push(path);
          return collectors().githubApi(path);
        },
      }),
      NOW,
    );
    // The actions resolve concurrently, so only the set of calls is stable.
    expect(calls.sort()).toEqual([
      'repos/actions/checkout/commits/v4.4.0',
      'repos/actions/checkout/releases/latest',
      'repos/supabase/setup-cli/commits/v3.0.1',
      'repos/supabase/setup-cli/releases/latest',
    ]);
    expect(section(ok.markdown, 'GitHub Actions')).toContain(
      '| actions/checkout | v4.4.0 | v7.0.1 | Update to v7.0.1 (major: read the release notes) |',
    );
    const bad = await runReport(
      collectors({
        githubApi: async () => {
          throw new Error('API rate limit exceeded');
        },
      }),
      NOW,
    );
    expect(bad.exitCode).toBe(1);
    expect(bad.errors).toEqual(['github actions: API rate limit exceeded']);
    expect(section(bad.markdown, 'GitHub Actions')).toContain(
      'Could not check: API rate limit exceeded',
    );
    expect(bad.markdown).toContain('No high or critical vulnerabilities');
  });

  test('compares the setup-cli pin with the npm release of the Supabase CLI', async () => {
    const result = await runReport(collectors(), NOW);
    expect(result.errors).toEqual([]);
    expect(section(result.markdown, 'Supabase CLI')).toContain(
      '| 2.122.0 | 3.0.0 | https://github.com/supabase/cli/releases/tag/v3.0.0 | Update to 3.0.0 (major: read the release notes and the migration guide) |',
    );
  });

  test('exits 1 when the Supabase CLI release cannot be read', async () => {
    const result = await runReport(
      collectors({
        supabaseCliRegistry: async () => {
          throw new Error('npm answered 503');
        },
      }),
      NOW,
    );
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual(['supabase cli: npm answered 503']);
    expect(section(result.markdown, 'Supabase CLI')).toContain(
      'Could not check: npm answered 503',
    );
    expect(result.markdown.split('\n')[2]).toContain(
      'Supabase CLI check failed',
    );
    expect(result.markdown).toContain('No high or critical vulnerabilities');
  });

  test('exits 1 when no workflow pins the Supabase CLI version', async () => {
    const result = await runReport(
      collectors({
        workflows: async () => [`- uses: actions/checkout@${SHA_A} # v4.4.0\n`],
      }),
      NOW,
    );
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      'supabase cli: no supabase/setup-cli step pins a version',
    ]);
  });

  test('exits 1 when a uses line has no tag comment', async () => {
    const result = await runReport(
      collectors({
        workflows: async () => ['- uses: owner/repo@abc\n', SETUP_CLI_STEP],
      }),
      NOW,
    );
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      'github actions: owner/repo has no release tag comment',
    ]);
  });

  test('reads the Stripe files and exits 1 with the reason when they cannot be read', async () => {
    const ok = await runReport(collectors(), NOW);
    expect(ok.errors).toEqual([]);
    expect(section(ok.markdown, 'Stripe API version')).toContain(
      '| 2026-10-28.endive | stripe 23.1.0 | 2026-10-28.endive | Matches the SDK |',
    );
    const missing = await runReport(
      collectors({
        stripeApi: async () => {
          throw new Error(
            "ENOENT: no such file or directory, open 'node_modules/stripe/esm/apiVersion.js'",
          );
        },
      }),
      NOW,
    );
    expect(missing.exitCode).toBe(1);
    expect(missing.errors).toEqual([
      "stripe api version: ENOENT: no such file or directory, open 'node_modules/stripe/esm/apiVersion.js'",
    ]);
    expect(section(missing.markdown, 'Stripe API version')).toContain(
      "Could not check: ENOENT: no such file or directory, open 'node_modules/stripe/esm/apiVersion.js'",
    );
    expect(missing.markdown).toContain('No high or critical vulnerabilities');
    const stale = await runReport(
      collectors({
        stripeApi: async () =>
          stripeFiles({
            sdkPackageJson: JSON.stringify({ version: '22.1.0' }),
          }),
      }),
      NOW,
    );
    expect(stale.exitCode).toBe(1);
    expect(stale.errors).toEqual([
      'stripe api version: installed stripe 22.1.0 is not the pinned 23.1.0: run `bun install`',
    ]);
  });
});

describe('runtime parsers', () => {
  test('parseNodeReleases keeps version, date, LTS name and the security flag', () => {
    expect(parseNodeReleases(NODE_INDEX).slice(0, 2)).toEqual([
      {
        version: '26.13.0',
        date: '2026-10-28',
        lts: 'Lithium',
        security: false,
      },
      { version: '25.9.0', date: '2026-03-31', lts: false, security: false },
    ]);
    expect(() => parseNodeReleases('{}')).toThrow(
      'unrecognized Node release list',
    );
  });

  test('parseNodeSchedule keys lines by major and skips pre-1.0 lines', () => {
    const schedule = parseNodeSchedule(NODE_SCHEDULE);
    expect(schedule.get(24)).toEqual({
      major: 24,
      lts: '2025-10-28',
      end: '2028-04-30',
    });
    expect(schedule.get(25)).toEqual({
      major: 25,
      lts: undefined,
      end: '2026-06-01',
    });
    expect([...schedule.keys()]).toEqual([22, 24, 25, 26]);
    expect(() => parseNodeSchedule('{}')).toThrow(
      'unrecognized Node release schedule',
    );
  });

  test('parseBunRegistry reads the latest version and its publish date', () => {
    expect(parseBunRegistry(BUN_REGISTRY)).toEqual({
      version: '1.4.4',
      releasedAt: '2026-10-22T10:19:13.548Z',
    });
    expect(() => parseBunRegistry('{}')).toThrow('no latest version for bun');
  });
});

describe('nodeRuntimeStatus', () => {
  const status = (pinned: string, now: Date) =>
    nodeRuntimeStatus(pinned, nodeData.releases, nodeData.schedule, now);

  test('flags a newer patch of the pinned line and says when it is a security release', () => {
    const result = status('24.22.2', NOW);
    expect(result.latestInLine).toBe('24.23.0');
    expect(result.end).toBe('2028-04-30');
    expect(result.actions).toEqual(['Update to 24.23.0 (security release)']);
  });

  test('does not call a patch a security release when none in between is one', () => {
    const releases = parseNodeReleases(
      JSON.stringify([
        {
          version: 'v24.22.3',
          date: '2026-10-01',
          lts: 'Krypton',
          security: false,
        },
        {
          version: 'v24.22.2',
          date: '2026-09-01',
          lts: 'Krypton',
          security: false,
        },
      ]),
    );
    expect(
      nodeRuntimeStatus('24.22.2', releases, nodeData.schedule, NOW).actions,
    ).toEqual(['Update to 24.22.3']);
  });

  test('waits about three months after a new LTS line before recommending it', () => {
    const early = status('24.23.0', NOW);
    expect(early.actions).toEqual([]);
    expect(early.notes).toEqual([
      'Node 26 is LTS since 2026-10-28: move to it after 2027-01-26',
    ]);
    const later = status('24.23.0', new Date('2027-02-01T00:00:00.000Z'));
    expect(later.actions).toEqual(['Move to Node 26 (LTS since 2026-10-28)']);
    expect(later.notes).toEqual([]);
  });

  test('warns when the pinned line ends within six months or has ended', () => {
    const ending = status('22.23.4', new Date('2027-01-15T00:00:00.000Z'));
    expect(ending.actions).toEqual([
      'Node 22 support ends 2027-04-30',
      'Move to Node 24 (LTS since 2025-10-28)',
    ]);
    expect(ending.notes).toEqual([
      'Node 26 is LTS since 2026-10-28: move to it after 2027-01-26',
    ]);
    const ended = status('22.23.4', new Date('2027-05-01T00:00:00.000Z'));
    expect(ended.actions[0]).toBe(
      'Node 22 is no longer supported (ended 2027-04-30)',
    );
  });

  test('rejects a pinned line that is not in the release schedule', () => {
    expect(() => status('23.1.0', NOW)).toThrow(
      'Node 23 is not in the release schedule',
    );
  });
});

describe('bunRuntimeStatus', () => {
  const bun = parseBunRegistry(BUN_REGISTRY);

  test('recommends a release that is at least 3 days old', () => {
    expect(bunRuntimeStatus('1.4.2', bun, NOW)).toEqual({
      actions: ['Update to 1.4.4'],
      notes: [],
    });
  });

  test('waits for a release younger than 3 days', () => {
    expect(
      bunRuntimeStatus(
        '1.4.2',
        { version: '1.4.5', releasedAt: '2026-10-28T12:00:00.000Z' },
        NOW,
      ),
    ).toEqual({
      actions: [],
      notes: ['Bun 1.4.5 is 1 days old: update after 2026-10-31'],
    });
  });

  test('is up to date on the latest release', () => {
    expect(bunRuntimeStatus('1.4.4', bun, NOW)).toEqual({
      actions: [],
      notes: [],
    });
  });
});

describe('Runtimes section', () => {
  const runtimes = (node: string, bun: string): ReportInput['runtimes'] => ({
    ok: true,
    value: {
      pins: { node, bun },
      ...nodeData,
      bun: parseBunRegistry(BUN_REGISTRY),
    },
  });

  test('lists both runtimes with their pending actions and counts them in the summary', () => {
    const report = buildDependencyReport(
      baseInput({ runtimes: runtimes('24.22.2', '1.4.2') }),
      NOW,
    );
    const runtimeSection = section(report, 'Runtimes');
    expect(runtimeSection).toContain(
      '| Node | 24.22.2 | 24.23.0 | 2028-04-30 | Update to 24.23.0 (security release). Node 26 is LTS since 2026-10-28: move to it after 2027-01-26 |',
    );
    expect(runtimeSection).toContain(
      '| Bun | 1.4.2 | 1.4.4 | - | Update to 1.4.4 |',
    );
    expect(runtimeSection).toContain('.nvmrc');
    expect(report.split('\n')[2]).toContain('2 runtime updates');
  });

  test('says up to date when no runtime needs an action', () => {
    const report = buildDependencyReport(baseInput(), NOW);
    expect(section(report, 'Runtimes')).toContain(
      '| Bun | 1.4.4 | 1.4.4 | - | Up to date |',
    );
    expect(report.split('\n')[2]).toContain('runtimes up to date');
  });

  test('reports a failed runtime check without hiding the other sections', () => {
    const report = buildDependencyReport(
      baseInput({ runtimes: { ok: false, error: 'nodejs.org answered 503' } }),
      NOW,
    );
    expect(section(report, 'Runtimes')).toContain(
      'Could not check: nodejs.org answered 503',
    );
    expect(report.split('\n')[2]).toContain('runtime check failed');
    expect(report).toContain('## Security (bun audit)');
  });
});

describe('Supabase CLI section', () => {
  const cli = (
    pinned: string,
    version: string,
    releasedAt: string,
  ): ReportInput['supabaseCli'] => ({
    ok: true,
    value: { pinned, latest: { version, releasedAt } },
  });

  test('reads the version pinned on supabase/setup-cli', () => {
    expect(parseSupabaseCliPin([`steps:\n${SETUP_CLI_STEP}`])).toBe('2.122.0');
    expect(
      parseSupabaseCliPin([
        `steps:\n${SETUP_CLI_STEP}`,
        `jobs:\n${SETUP_CLI_STEP.replace('2.122.0', "'2.122.0'")}`,
      ]),
    ).toBe('2.122.0');
  });

  test('rejects a missing, inexact or conflicting pin', () => {
    expect(() =>
      parseSupabaseCliPin([`- uses: actions/checkout@${SHA_A} # v4.4.0\n`]),
    ).toThrow('no supabase/setup-cli step pins a version');
    expect(() =>
      parseSupabaseCliPin([SETUP_CLI_STEP.replace('2.122.0', 'latest')]),
    ).toThrow('supabase/setup-cli version "latest" is not an exact version');
    expect(() =>
      parseSupabaseCliPin([
        SETUP_CLI_STEP,
        SETUP_CLI_STEP.replace('2.122.0', '3.0.0'),
      ]),
    ).toThrow('supabase/setup-cli pins differ: 2.122.0, 3.0.0');
  });

  test('says nothing to do when the pin is the latest release', () => {
    expect(
      supabaseCliStatus(
        '3.0.0',
        { version: '3.0.0', releasedAt: daysAgo(10) },
        NOW,
      ),
    ).toEqual({ actions: [], notes: [] });
  });

  test('asks for a minor or patch update without the major warning', () => {
    expect(
      supabaseCliStatus(
        '2.122.0',
        { version: '2.123.1', releasedAt: daysAgo(3) },
        NOW,
      ),
    ).toEqual({ actions: ['Update to 2.123.1'], notes: [] });
  });

  test('asks to read the release notes and the migration guide on a major', () => {
    expect(
      supabaseCliStatus(
        '2.122.0',
        { version: '3.0.0', releasedAt: daysAgo(7) },
        NOW,
      ),
    ).toEqual({
      actions: [
        'Update to 3.0.0 (major: read the release notes and the migration guide)',
      ],
      notes: [],
    });
  });

  test('waits for a release younger than the minimum age', () => {
    expect(
      supabaseCliStatus(
        '2.122.0',
        { version: '3.0.1', releasedAt: '2026-10-27T12:00:00Z' },
        NOW,
      ),
    ).toEqual({
      actions: [],
      notes: ['Supabase CLI 3.0.1 is 2 days old: update after 2026-10-30'],
    });
  });

  test('renders the table, the guide pointer and the summary between Runtimes and GitHub Actions', () => {
    const report = buildDependencyReport(baseInput(), NOW);
    const cliSection = section(report, 'Supabase CLI');
    expect(cliSection).toContain(
      '| Pinned | Latest | Release notes | Status |',
    );
    expect(cliSection).toContain(
      '| 3.0.0 | 3.0.0 | https://github.com/supabase/cli/releases/tag/v3.0.0 | Up to date |',
    );
    expect(cliSection).toContain('.github/workflows/ci.yml');
    expect(cliSection).toContain('Docker Desktop');
    expect(cliSection).toContain('Keep the Supabase CLI and Docker current');
    expect(report.indexOf('## Supabase CLI')).toBeGreaterThan(
      report.indexOf('## Runtimes'),
    );
    expect(report.indexOf('## Supabase CLI')).toBeLessThan(
      report.indexOf('## GitHub Actions'),
    );
    expect(report.split('\n')[2]).toContain(
      'runtimes up to date, Supabase CLI up to date, Stripe API version matches the SDK, actions up to date',
    );
  });

  test('words the summary for an update and a failed check', () => {
    const line = (supabaseCli: ReportInput['supabaseCli']) =>
      buildDependencyReport(baseInput({ supabaseCli }), NOW).split('\n')[2];
    expect(line(cli('2.122.0', '3.0.0', daysAgo(7)))).toContain(
      'Supabase CLI update,',
    );
    expect(line(cli('2.122.0', '3.0.1', daysAgo(1)))).toContain(
      'Supabase CLI up to date,',
    );
    expect(line({ ok: false, error: 'boom' })).toContain(
      'Supabase CLI check failed,',
    );
  });
});

describe('Stripe API version section', () => {
  const DAHLIA =
    "export const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-04-22.dahlia';\n";

  test('reads the version the functions send, the pin and the API version the installed SDK ships', () => {
    expect(parseStripeApi(stripeFiles())).toEqual({
      sent: '2026-10-28.endive',
      pinned: '23.1.0',
      sdkApiVersion: '2026-10-28.endive',
    });
    expect(parseStripeApi(stripeFiles({ apiVersion: DAHLIA }))).toEqual({
      sent: '2026-04-22.dahlia',
      pinned: '23.1.0',
      sdkApiVersion: '2026-10-28.endive',
    });
  });

  test('rejects a missing literal, a missing pin and an installed SDK that is not the pin', () => {
    expect(() =>
      parseStripeApi(
        stripeFiles({
          apiVersion:
            "export const STRIPE_API_VERSION = process.env.VERSION ?? '';\n",
        }),
      ),
    ).toThrow(
      'no STRIPE_API_VERSION literal in supabase/functions/_shared/stripe/api-version.ts',
    );
    expect(() =>
      parseStripeApi(
        stripeFiles({ packageJson: JSON.stringify({ devDependencies: {} }) }),
      ),
    ).toThrow('no stripe devDependency in package.json');
    expect(() =>
      parseStripeApi(stripeFiles({ sdkApiVersion: 'export {};\n' })),
    ).toThrow('no ApiVersion in node_modules/stripe/esm/apiVersion.js');
    expect(() =>
      parseStripeApi(
        stripeFiles({
          sdkPackageJson: JSON.stringify({ name: 'stripe', version: '22.1.0' }),
        }),
      ),
    ).toThrow(
      'installed stripe 22.1.0 is not the pinned 23.1.0: run `bun install`',
    );
  });

  test('matches when the functions send the API version the SDK ships', () => {
    expect(stripeApiStatus(parseStripeApi(stripeFiles()))).toEqual({
      actions: [],
      notes: [],
    });
  });

  test('flags a mismatch with both versions and the SDK version', () => {
    expect(
      stripeApiStatus(parseStripeApi(stripeFiles({ apiVersion: DAHLIA }))),
    ).toEqual({
      actions: [
        'Mismatch: the functions send 2026-04-22.dahlia, stripe 23.1.0 ships 2026-10-28.endive. Bump the SDK pin and STRIPE_API_VERSION together in one change',
      ],
      notes: [],
    });
  });

  test('renders the table and the guide pointer between Supabase CLI and GitHub Actions', () => {
    const report = buildDependencyReport(baseInput(), NOW);
    expect(section(report, 'Stripe API version')).toBe(
      [
        '## Stripe API version',
        '',
        '| STRIPE_API_VERSION | SDK pin | SDK API version | Status |',
        '| --- | --- | --- | --- |',
        '| 2026-10-28.endive | stripe 23.1.0 | 2026-10-28.endive | Matches the SDK |',
        '',
        'The functions send `STRIPE_API_VERSION` from `supabase/functions/_shared/stripe/api-version.ts`. The SDK pin is the root `stripe` devDependency, which only `supabase/functions/_shared/stripe/sdk.ts` imports. Move both in one change (see `docs/dependencies.md`, "Keep the Stripe SDK and API version together").',
        '',
      ].join('\n'),
    );
    expect(report.indexOf('## Stripe API version')).toBeGreaterThan(
      report.indexOf('## Supabase CLI'),
    );
    expect(report.indexOf('## Stripe API version')).toBeLessThan(
      report.indexOf('## GitHub Actions'),
    );
    expect(report.split('\n')[2]).toContain(
      'Supabase CLI up to date, Stripe API version matches the SDK, actions up to date',
    );
  });

  test('renders a mismatch row and words the summary for a mismatch and a failed check', () => {
    const report = buildDependencyReport(
      baseInput({
        stripeApi: {
          ok: true,
          value: parseStripeApi(stripeFiles({ apiVersion: DAHLIA })),
        },
      }),
      NOW,
    );
    expect(section(report, 'Stripe API version')).toContain(
      '| 2026-04-22.dahlia | stripe 23.1.0 | 2026-10-28.endive | Mismatch: the functions send 2026-04-22.dahlia, stripe 23.1.0 ships 2026-10-28.endive. Bump the SDK pin and STRIPE_API_VERSION together in one change |',
    );
    expect(report.split('\n')[2]).toContain('Stripe API version mismatch,');
    const failedReport = buildDependencyReport(
      baseInput({ stripeApi: { ok: false, error: 'boom' } }),
      NOW,
    );
    expect(section(failedReport, 'Stripe API version')).toContain(
      'Could not check: boom',
    );
    expect(failedReport.split('\n')[2]).toContain('Stripe API check failed,');
  });
});

describe('GitHub Actions section', () => {
  const release = (tag: string, publishedAt: string) => ({
    latest: { tag, publishedAt },
  });
  const status = (overrides: Partial<ActionRow>) =>
    actionStatus(actionRow(overrides), NOW);

  test('parses the latest release and the commit of a tag', () => {
    expect(
      parseLatestRelease(
        '{"tag_name":"v7.0.1","published_at":"2026-10-01T00:00:00Z"}',
      ),
    ).toEqual({ tag: 'v7.0.1', publishedAt: '2026-10-01T00:00:00Z' });
    expect(() => parseLatestRelease('{"tag_name":"nightly"}')).toThrow();
    expect(parseCommitSha(`{"sha":"${SHA_B}"}`)).toBe(SHA_B);
    expect(() => parseCommitSha('{}')).toThrow();
  });

  test('says nothing to do when the pin is the latest release', () => {
    expect(status({})).toEqual({ actions: [], notes: [] });
  });

  test('asks for a minor or patch update without the major warning', () => {
    expect(status(release('v4.5.0', '2026-10-01T00:00:00Z'))).toEqual({
      actions: ['Update to v4.5.0'],
      notes: [],
    });
  });

  test('asks to read the release notes when the major changes', () => {
    expect(status(release('v7.0.1', '2026-10-01T00:00:00Z'))).toEqual({
      actions: ['Update to v7.0.1 (major: read the release notes)'],
      notes: [],
    });
  });

  test('waits for a release younger than the minimum age', () => {
    expect(status(release('v7.0.1', '2026-10-27T12:00:00Z'))).toEqual({
      actions: [],
      notes: ['v7.0.1 is 2 days old: update after 2026-10-30'],
    });
  });

  test('ignores a latest release that is not newer than the pin', () => {
    expect(status(release('v4.3.0', '2026-10-01T00:00:00Z'))).toEqual({
      actions: [],
      notes: [],
    });
  });

  test('flags a pinned SHA that is not the commit of its tag', () => {
    expect(status({ pinnedSha: SHA_B })).toEqual({
      actions: ['Pinned SHA is not v4.4.0 (resolves to aaaaaaa)'],
      notes: [],
    });
  });

  test('renders the table, the guide pointer and the summary after Runtimes', () => {
    const report = buildDependencyReport(baseInput(), NOW);
    const actions = section(report, 'GitHub Actions');
    expect(actions).toContain('| Action | Pinned | Latest | Status |');
    expect(actions).toContain(
      '| actions/checkout | v4.4.0 | v4.4.0 | Up to date |',
    );
    expect(actions).toContain('Keep GitHub Actions pinned');
    expect(report.indexOf('## GitHub Actions')).toBeGreaterThan(
      report.indexOf('## Runtimes'),
    );
    expect(report.indexOf('## GitHub Actions')).toBeLessThan(
      report.indexOf('## Security (bun audit)'),
    );
  });

  test('words the summary for none, several and failed checks', () => {
    const line = (actions: ReportInput['actions']) =>
      buildDependencyReport(baseInput({ actions }), NOW).split('\n')[2];
    const stale = (action: string) =>
      actionRow({ action, ...release('v5.0.0', '2026-10-01T00:00:00Z') });
    expect(line({ ok: true, value: [actionRow()] })).toContain(
      'actions up to date',
    );
    expect(line({ ok: true, value: [stale('a/a')] })).toContain(
      '1 action update,',
    );
    expect(line({ ok: true, value: [stale('a/a'), stale('b/b')] })).toContain(
      '2 action updates,',
    );
    expect(line({ ok: false, error: 'boom' })).toContain(
      'actions check failed',
    );
  });
});
