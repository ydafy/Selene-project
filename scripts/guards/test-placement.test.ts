import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

import { listRepoFiles } from './agent-instructions';
import { findTestFolderProblems, LEGACY_TEST_FOLDERS } from './test-placement';

const root = join(import.meta.dir, '..', '..');

describe('test folder placement (probes)', () => {
  const legacy = ['supabase/queries/__tests__'];

  it('reports a new __tests__ folder anywhere', () => {
    expect(
      findTestFolderProblems(
        [
          'supabase/queries/__tests__/a.test.ts',
          'apps/frontend/src/features/cart/__tests__/cart.test.ts',
        ],
        legacy,
      ),
    ).toEqual([
      'apps/frontend/src/features/cart/__tests__/: new test folder; put the test next to the file it tests (docs/conventions.md, "Test placement")',
    ]);
  });

  it('reports a top-level tests folder', () => {
    expect(
      findTestFolderProblems(
        ['supabase/queries/__tests__/a.test.ts', 'tests/orders/order.test.ts'],
        legacy,
      ),
    ).toEqual([
      'tests/: new test folder; put the test next to the file it tests (docs/conventions.md, "Test placement")',
    ]);
  });

  it('reports a legacy folder that no longer exists', () => {
    expect(findTestFolderProblems(['apps/frontend/a.test.ts'], legacy)).toEqual(
      [
        'supabase/queries/__tests__/: listed in LEGACY_TEST_FOLDERS but it no longer exists; remove the entry',
      ],
    );
  });

  it('accepts tests next to their files, nested tests folders, and legacy folders', () => {
    expect(
      findTestFolderProblems(
        [
          'supabase/queries/__tests__/a.test.ts',
          'apps/frontend/src/shared/i18n/auth-locale-parity.test.ts',
          'supabase/tests/database/orders.sql',
          'docs/__tests__.md',
        ],
        legacy,
      ),
    ).toEqual([]);
  });
});

describe('test folder placement (repository)', () => {
  it('has no test folder outside the legacy list', () => {
    expect(
      findTestFolderProblems(listRepoFiles(root), LEGACY_TEST_FOLDERS),
    ).toEqual([]);
  });
});
