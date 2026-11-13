import { describe, expect, test } from 'bun:test';
import {
  applyConnectAccountActionability,
  extractSignedAccountEventData,
  type ConnectAccountActionabilityDeps,
} from './connect-payout-reconciliation';

// Exercise the REAL orchestrator with mocked Stripe/RPC IO, not Stripe/PG
// execution proof. Snapshot fields mirror A2's explicit commit contract.
type Bank = {
  id: string;
  object: 'bank_account';
  account: string | { id: string; object: 'account' } | null;
  currency: string;
  default_for_currency: boolean | null;
  status: string | null;
};
type Snapshot = {
  accountId: string;
  generation: number;
  sourceEventId: string;
  actionable: boolean;
  blockedReason: string | null;
  payoutsEnabled: boolean | null;
  externalAccountId: string | null;
  externalAccountStatus: string | null;
  currency: string | null;
  defaultForCurrency: boolean | null;
  mxnDefaultCount: number | null;
  payoutScheduleInterval: string | null;
};
type RetrievedAccount = {
  id: string;
  payouts_enabled: boolean | null;
  settings?: { payouts?: { schedule?: { interval?: string } } };
};
const manualSchedule = { payouts: { schedule: { interval: 'manual' } } };
type CurrentDeps = ConnectAccountActionabilityDeps & {
  // Unknown at the IO boundary: validate numeric/string BIGINT serialization.
  acquireAccountRefresh: (input: {
    accountId: string;
    sourceEventId: string;
  }) => Promise<unknown>;
  retrieveCurrentAccount: (input: {
    accountId: string;
  }) => Promise<RetrievedAccount>;
  listCurrentBankAccounts: (input: {
    accountId: string;
    startingAfter?: string;
  }) => Promise<{ data: Bank[]; has_more: boolean }>;
  commitAccountRefresh: (input: Snapshot) => Promise<boolean>;
  projectAccountActionability: (input: unknown) => Promise<void>; // legacy-call trap, never a production dependency
};
const bank = (overrides: Partial<Bank> = {}): Bank => ({
  id: 'ba_current',
  object: 'bank_account',
  account: 'acct_1',
  currency: 'mxn',
  default_for_currency: true,
  status: 'verified',
  ...overrides,
});
const event = (healthy = false) => ({
  eventId: 'evt_oldbank',
  eventType: 'account.external_account.updated',
  accountId: 'acct_1',
  occurredAt: '2026-10-04T05:09:11.000Z',
  externalAccountId: 'ba_old',
  payoutsEnabled: null,
  externalAccountStatus: healthy ? 'verified' : 'errored',
  resolution: {
    actionable: healthy,
    blockedReason: healthy ? null : 'errored',
    undetermined: false,
  },
});
function harness(
  options: {
    payoutsEnabled?: boolean | null;
    banks?: Bank[];
    duplicate?: boolean;
    retrievalError?: Error;
    commitAccepted?: boolean;
    retrievedAccountId?: string;
    /** undefined = manual; null = the account has no payout schedule. */
    payoutScheduleInterval?: string | null;
  } = {},
) {
  const sequence: string[] = [];
  const evidence: Parameters<CurrentDeps['recordAccountEvent']>[0][] = [];
  const commits: Snapshot[] = [];
  const legacy: unknown[] = [];
  const pages: Parameters<CurrentDeps['listCurrentBankAccounts']>[0][] = [];
  let generation = 0;
  const deps: CurrentDeps = {
    recordAccountEvent: async (input) => {
      sequence.push('evidence');
      if (
        !options.duplicate &&
        !evidence.some((row) => row.eventId === input.eventId)
      )
        evidence.push(input);
      return !options.duplicate;
    },
    projectAccountActionability: async (input) => {
      sequence.push('legacy');
      legacy.push(input);
    },
    acquireAccountRefresh: async (input) => {
      expect(input).toEqual({
        accountId: 'acct_1',
        sourceEventId: 'evt_oldbank',
      });
      sequence.push('acquire');
      return ++generation;
    },
    retrieveCurrentAccount: async (input) => {
      expect(input).toEqual({ accountId: 'acct_1' });
      sequence.push('retrieve');
      if (options.retrievalError) throw options.retrievalError;
      const interval =
        options.payoutScheduleInterval === undefined
          ? 'manual'
          : options.payoutScheduleInterval;
      return {
        id: options.retrievedAccountId ?? 'acct_1',
        payouts_enabled:
          options.payoutsEnabled === undefined ? true : options.payoutsEnabled,
        ...(interval === null
          ? {}
          : { settings: { payouts: { schedule: { interval } } } }),
      };
    },
    listCurrentBankAccounts: async (input) => {
      sequence.push('list');
      pages.push(input);
      return { data: options.banks ?? [bank()], has_more: false };
    },
    commitAccountRefresh: async (input) => {
      sequence.push('commit');
      commits.push(input);
      return options.commitAccepted !== false;
    },
  };
  return { deps, sequence, evidence, commits, legacy, pages };
}

describe('current MXN destination reconciliation (real orchestrator, mocked IO)', () => {
  test('retains old errored bank evidence but projects current healthy default', async () => {
    const h = harness();
    await applyConnectAccountActionability(event(), h.deps);
    expect(h.evidence[0]).toMatchObject({
      externalAccountId: 'ba_old',
      resolution: { blockedReason: 'errored' },
    });
    expect(h.commits).toEqual([
      {
        accountId: 'acct_1',
        generation: 1,
        sourceEventId: 'evt_oldbank',
        actionable: true,
        blockedReason: null,
        payoutsEnabled: true,
        externalAccountId: 'ba_current',
        externalAccountStatus: 'verified',
        currency: 'mxn',
        defaultForCurrency: true,
        mxnDefaultCount: 1,
        payoutScheduleInterval: 'manual',
      },
    ]);
    expect(h.legacy).toEqual([]);
  });

  for (const [name, options, reason] of [
    [
      'errored current default',
      { banks: [bank({ status: 'errored' })] },
      'errored',
    ],
    ['disabled payouts', { payoutsEnabled: false }, 'payouts_disabled'],
    [
      'no MXN default',
      { banks: [bank({ currency: 'usd' })] },
      'destination_undetermined',
    ],
    [
      'ambiguous MXN defaults',
      { banks: [bank(), bank({ id: 'ba_second' })] },
      'destination_undetermined',
    ],
    [
      'missing payouts flag',
      { payoutsEnabled: null },
      'destination_undetermined',
    ],
    [
      'unknown current status',
      { banks: [bank({ status: 'future_unknown' })] },
      'destination_undetermined',
    ],
  ] as const) {
    test(`${name} never enables payouts from historical healthy evidence`, async () => {
      const h = harness(options);
      await applyConnectAccountActionability(event(true), h.deps);
      expect(h.commits).toHaveLength(1);
      expect(h.commits[0]).toMatchObject({
        actionable: false,
        blockedReason: reason,
      });
      expect(h.legacy).toEqual([]);
    });
  }

  test('paginates beyond ten banks and finds the MXN default on the second page', async () => {
    const h = harness();
    h.deps.listCurrentBankAccounts = async (input) => {
      h.pages.push(input);
      return input.startingAfter === undefined
        ? {
            data: Array.from({ length: 10 }, (_, i) =>
              bank({ id: `ba_${i}`, default_for_currency: false }),
            ),
            has_more: true,
          }
        : { data: [bank()], has_more: false };
    };
    await applyConnectAccountActionability(event(), h.deps);
    expect(h.pages).toEqual([
      { accountId: 'acct_1' },
      { accountId: 'acct_1', startingAfter: 'ba_9' },
    ]);
    expect(h.commits[0]).toMatchObject({
      actionable: true,
      externalAccountId: 'ba_current',
    });
  });

  test('retrieval failure propagates for webhook retry without any healthy projection', async () => {
    const h = harness({ retrievalError: new Error('stripe unavailable') });
    await expect(
      applyConnectAccountActionability(event(true), h.deps),
    ).rejects.toThrow('stripe unavailable');
    expect(h.sequence).toEqual(['evidence', 'acquire', 'retrieve']);
    expect(h.commits).toEqual([]);
    expect(h.legacy).toEqual([]);
  });

  test('duplicate durable evidence still rechecks current state without rewriting evidence', async () => {
    const h = harness();
    await applyConnectAccountActionability(event(), h.deps);
    h.deps.retrieveCurrentAccount = async () => {
      h.sequence.push('retrieve');
      return { id: 'acct_1', payouts_enabled: false, settings: manualSchedule };
    };
    await applyConnectAccountActionability(event(), h.deps);
    expect(h.evidence).toHaveLength(1);
    expect(h.commits.map(({ actionable }) => actionable)).toEqual([
      true,
      false,
    ]);
    expect(h.sequence.filter((step) => step === 'acquire')).toHaveLength(2);
  });

  test('equal-second evidence does not silently suppress a current-state restore', async () => {
    const h = harness({ banks: [bank({ status: 'errored' })] });
    await applyConnectAccountActionability(event(), h.deps);
    h.deps.listCurrentBankAccounts = async () => ({
      data: [bank()],
      has_more: false,
    });
    await applyConnectAccountActionability(event(), h.deps);
    expect(
      h.commits.map(({ generation, actionable }) => ({
        generation,
        actionable,
      })),
    ).toEqual([
      { generation: 1, actionable: false },
      { generation: 2, actionable: true },
    ]);
    // Timestamp equality stays evidence, not a current-state commit gate.
    expect(h.legacy).toEqual([]);
  });

  test('acquires generation before any network read', async () => {
    const h = harness();
    await applyConnectAccountActionability(event(), h.deps);
    expect(h.sequence).toEqual([
      'evidence',
      'acquire',
      'retrieve',
      'list',
      'commit',
    ]);
  });

  test('CAS refusal of a superseded response is observable rather than healthy success', async () => {
    const h = harness({ commitAccepted: false });
    // Mock SQL refusal only; real SQL compare-and-swap is structurally tested separately.
    await expect(
      applyConnectAccountActionability(event(), h.deps),
    ).rejects.toThrow('ACCOUNT_REFRESH_SUPERSEDED');
    expect(h.commits).toHaveLength(1);
    expect(h.legacy).toEqual([]);
  });

  test('late healthy response cannot overwrite a newer blocked refresh (mock CAS interleaving)', async () => {
    const h = harness();
    let release!: (value: RetrievedAccount) => void;
    const delayed = new Promise<RetrievedAccount>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    h.deps.retrieveCurrentAccount = async () =>
      ++reads === 1
        ? delayed
        : { id: 'acct_1', payouts_enabled: false, settings: manualSchedule };
    let currentGeneration = 0;
    let durableActionable = false;
    h.deps.acquireAccountRefresh = async () => ++currentGeneration;
    h.deps.commitAccountRefresh = async (input) => {
      h.commits.push(input);
      if (input.generation !== currentGeneration) return false;
      durableActionable = input.actionable;
      return true;
    };
    const first = applyConnectAccountActionability(event(), h.deps).then(
      () => 'accepted',
      (error: Error) => error.message,
    );
    // Advance the first invocation through evidence/acquire into its deferred read.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await applyConnectAccountActionability(event(), h.deps);
    release({ id: 'acct_1', payouts_enabled: true, settings: manualSchedule });
    expect(await first).toBe('ACCOUNT_REFRESH_SUPERSEDED');
    expect(h.commits.map(({ generation }) => generation)).toEqual([2, 1]);
    expect(durableActionable).toBe(false);
    expect(h.legacy).toEqual([]);
  });

  test('retrieved account identity mismatch cannot commit to the signed account', async () => {
    const h = harness({ retrievedAccountId: 'acct_other' });
    await expect(
      applyConnectAccountActionability(event(), h.deps),
    ).rejects.toThrow('ACCOUNT_REFRESH_IDENTITY_MISMATCH');
    expect(h.commits).toEqual([]);
  });

  test('bank identity mismatch cannot enable the signed account', async () => {
    const h = harness({ banks: [bank({ account: 'acct_other' })] });
    await expect(
      applyConnectAccountActionability(event(), h.deps),
    ).rejects.toThrow('ACCOUNT_REFRESH_IDENTITY_MISMATCH');
    expect(h.commits).toEqual([]);
  });
});

describe('additional current-state failure contracts (real orchestrator, mocked IO)', () => {
  for (const status of [
    'verification_failed',
    'tokenized_account_number_deactivated',
  ] as const) {
    test(`${status} current default blocks`, async () => {
      const h = harness({ banks: [bank({ status })] });
      await applyConnectAccountActionability(event(true), h.deps);
      expect(h.commits[0]).toMatchObject({
        actionable: false,
        blockedReason: status,
      });
    });
  }
  test('disabled payouts takes precedence over an errored bank', async () => {
    const h = harness({
      payoutsEnabled: false,
      banks: [bank({ status: 'errored' })],
    });
    await applyConnectAccountActionability(event(true), h.deps);
    expect(h.commits[0]).toMatchObject({
      actionable: false,
      blockedReason: 'payouts_disabled',
    });
  });
  test('other currencies and non-default errored banks do not block the sole MXN default', async () => {
    const h = harness({
      banks: [
        bank({ id: 'ba_usd', currency: 'usd', status: 'errored' }),
        bank({ id: 'ba_old', default_for_currency: false, status: 'errored' }),
        bank(),
      ],
    });
    await applyConnectAccountActionability(event(), h.deps);
    expect(h.commits[0]).toMatchObject({
      actionable: true,
      externalAccountId: 'ba_current',
      mxnDefaultCount: 1,
    });
  });
  test('expanded Stripe Account ownership is explicitly normalized', async () => {
    const h = harness({
      banks: [bank({ account: { id: 'acct_1', object: 'account' } })],
    });
    await applyConnectAccountActionability(event(), h.deps);
    expect(h.commits[0]).toMatchObject({ actionable: true });
  });
  test('missing bank ownership refuses the refresh', async () => {
    const h = harness({ banks: [bank({ account: null })] });
    await expect(
      applyConnectAccountActionability(event(), h.deps),
    ).rejects.toThrow('ACCOUNT_REFRESH_IDENTITY_MISMATCH');
    expect(h.commits).toEqual([]);
  });
  test('null default flag cannot conceal an ambiguous MXN destination', async () => {
    const h = harness({
      banks: [bank(), bank({ id: 'ba_unknown', default_for_currency: null })],
    });
    await applyConnectAccountActionability(event(true), h.deps);
    expect(h.commits[0]).toMatchObject({
      actionable: false,
      blockedReason: 'destination_undetermined',
      externalAccountId: null,
      externalAccountStatus: null,
      currency: null,
      defaultForCurrency: null,
      mxnDefaultCount: null,
    });
  });
  test('missing current status never enables payouts', async () => {
    const h = harness({ banks: [bank({ status: null })] });
    await applyConnectAccountActionability(event(true), h.deps);
    expect(h.commits[0]).toMatchObject({
      actionable: false,
      blockedReason: 'destination_undetermined',
      externalAccountStatus: null,
    });
  });
  for (const generation of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.MAX_SAFE_INTEGER + 1,
    null,
    '0',
    '1.5',
    '9007199254740993',
    ' 1 ',
    true,
  ]) {
    test(`invalid acquired generation ${String(generation)} refuses before network`, async () => {
      const h = harness();
      h.deps.acquireAccountRefresh = async () => generation;
      await expect(
        applyConnectAccountActionability(event(), h.deps),
      ).rejects.toThrow('ACCOUNT_REFRESH_INVALID_GENERATION');
      expect(h.sequence).toEqual(['evidence']);
      expect(h.commits).toEqual([]);
    });
  }
  test('safe decimal-string generation is accepted without rounding', async () => {
    const h = harness();
    h.deps.acquireAccountRefresh = async () => '42';
    await applyConnectAccountActionability(event(), h.deps);
    expect(h.commits[0]).toMatchObject({ generation: 42, actionable: true });
  });
  test('commit error propagates without a successful refresh', async () => {
    const h = harness();
    h.deps.commitAccountRefresh = async () => {
      throw new Error('commit database unavailable');
    };
    await expect(
      applyConnectAccountActionability(event(), h.deps),
    ).rejects.toThrow('commit database unavailable');
    expect(h.legacy).toEqual([]);
  });
  test('a page retrieval error after the first page never commits a partial healthy list', async () => {
    const h = harness();
    h.deps.listCurrentBankAccounts = async (input) => {
      if (input.startingAfter) throw new Error('page unavailable');
      return { data: [bank()], has_more: true };
    };
    await expect(
      applyConnectAccountActionability(event(), h.deps),
    ).rejects.toThrow('page unavailable');
    expect(h.commits).toEqual([]);
  });
  test('empty has-more page refuses no progress', async () => {
    const h = harness();
    h.deps.listCurrentBankAccounts = async () => ({ data: [], has_more: true });
    await expect(
      applyConnectAccountActionability(event(), h.deps),
    ).rejects.toThrow('ACCOUNT_REFRESH_PAGINATION_NO_PROGRESS');
    expect(h.commits).toEqual([]);
  });
  test('repeated cursor refuses instead of looping or counting duplicate banks', async () => {
    const h = harness();
    let pages = 0;
    h.deps.listCurrentBankAccounts = async () => {
      if (++pages > 2) throw new Error('test loop guard');
      return { data: [bank()], has_more: true };
    };
    await expect(
      applyConnectAccountActionability(event(), h.deps),
    ).rejects.toThrow('ACCOUNT_REFRESH_PAGINATION_NO_PROGRESS');
    expect(pages).toBe(2);
    expect(h.commits).toEqual([]);
  });
  test('malformed page cannot be treated as a completed list', async () => {
    const h = harness();
    h.deps.listCurrentBankAccounts = async () =>
      ({ data: [bank()], has_more: null }) as never;
    await expect(
      applyConnectAccountActionability(event(), h.deps),
    ).rejects.toThrow('ACCOUNT_REFRESH_INVALID_BANK_PAGE');
    expect(h.commits).toEqual([]);
  });
  test('raw signed flags/status persist honestly while undetermined evidence still reconciles', async () => {
    const h = harness();
    const input = {
      ...event(),
      payoutsEnabled: false,
      externalAccountStatus: null,
      resolution: {
        actionable: false,
        blockedReason: null,
        undetermined: true,
      },
    };
    await applyConnectAccountActionability(input, h.deps);
    expect(h.evidence[0]).toMatchObject({
      payoutsEnabled: false,
      externalAccountStatus: null,
      externalAccountId: 'ba_old',
    });
    expect(h.commits[0]).toMatchObject({
      actionable: true,
      payoutsEnabled: true,
      externalAccountStatus: 'verified',
    });
  });
  test('expanded signed bank account owner retains bank evidence with envelope agreement', () => {
    expect(
      extractSignedAccountEventData({
        eventType: 'account.external_account.deleted',
        eventAccount: 'acct_1',
        dataObject: {
          id: 'ba_old',
          account: { id: 'acct_1', object: 'account' },
        },
      }),
    ).toMatchObject({
      accountId: 'acct_1',
      externalAccountId: 'ba_old',
      externalAccountStatus: null,
    });
  });
});

describe('payout schedule gate, layer 2 (#330 S4; real orchestrator, mocked IO)', () => {
  test('a manual schedule with a healthy bank stays actionable', async () => {
    const h = harness({ payoutScheduleInterval: 'manual' });
    await applyConnectAccountActionability(event(), h.deps);
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]).toMatchObject({
      actionable: true,
      blockedReason: null,
      payoutScheduleInterval: 'manual',
    });
  });
  for (const [name, interval, expected] of [
    ['a daily schedule', 'daily', 'daily'],
    ['a weekly schedule', 'weekly', 'weekly'],
    ['a missing schedule', null, null],
    ['an empty schedule interval', '', null],
  ] as const) {
    test(`${name} blocks payouts with payouts_schedule_not_manual`, async () => {
      const h = harness({ payoutScheduleInterval: interval });
      await applyConnectAccountActionability(event(true), h.deps);
      expect(h.commits).toEqual([
        {
          accountId: 'acct_1',
          generation: 1,
          sourceEventId: 'evt_oldbank',
          actionable: false,
          blockedReason: 'payouts_schedule_not_manual',
          payoutsEnabled: true,
          externalAccountId: 'ba_current',
          externalAccountStatus: 'verified',
          currency: 'mxn',
          defaultForCurrency: true,
          mxnDefaultCount: 1,
          payoutScheduleInterval: expected,
        },
      ]);
    });
  }
  test('a malformed schedule interval counts as a missing schedule', async () => {
    const h = harness();
    h.deps.retrieveCurrentAccount = async () =>
      ({
        id: 'acct_1',
        payouts_enabled: true,
        settings: { payouts: { schedule: { interval: 7 } } },
      }) as never;
    await applyConnectAccountActionability(event(true), h.deps);
    expect(h.commits[0]).toMatchObject({
      actionable: false,
      blockedReason: 'payouts_schedule_not_manual',
      payoutScheduleInterval: null,
    });
  });
  test('disabled payouts outrank a daily schedule', async () => {
    const h = harness({
      payoutsEnabled: false,
      payoutScheduleInterval: 'daily',
    });
    await applyConnectAccountActionability(event(true), h.deps);
    expect(h.commits[0]).toMatchObject({
      actionable: false,
      blockedReason: 'payouts_disabled',
      payoutScheduleInterval: 'daily',
    });
  });
  test('a daily schedule outranks an errored bank and an undetermined destination', async () => {
    for (const banks of [[bank({ status: 'errored' })], []]) {
      const h = harness({ payoutScheduleInterval: 'daily', banks });
      await applyConnectAccountActionability(event(true), h.deps);
      expect(h.commits[0]).toMatchObject({
        actionable: false,
        blockedReason: 'payouts_schedule_not_manual',
      });
    }
  });
});

// Routing and the RPC and Stripe adapters run through the handler in handler.test.ts.
describe('signed account event extraction', () => {
  for (const kind of ['created', 'deleted'] as const) {
    test(`extracts bank identity from signed external account ${kind}`, () => {
      expect(
        extractSignedAccountEventData({
          eventType: `account.external_account.${kind}`,
          eventAccount: 'acct_1',
          dataObject: {
            id: 'ba_old',
            object: 'bank_account',
            account: 'acct_1',
            status: 'errored',
          },
        }),
      ).toMatchObject({
        accountId: 'acct_1',
        externalAccountId: 'ba_old',
        externalAccountStatus: 'errored',
      });
    });
  }
  test('rejects conflicting signed envelope and object account identities', () => {
    expect(
      extractSignedAccountEventData({
        eventType: 'account.external_account.updated',
        eventAccount: 'acct_other',
        dataObject: { id: 'ba_old', account: 'acct_1', status: 'errored' },
      }),
    ).toBeNull();
  });
});
