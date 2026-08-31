import { expect, test } from 'bun:test';
import { projectEnviaShipmentConfiguration, resolveEnviaRuntimeConfiguration, runLabelClaimOrchestration } from '../envia-shipping.ts';

function harness(claimStatus = 'claimed') {
  const calls = { markSent: 0, provider: 0, finalize: 0, rejected: 0, orphan: 0 };
  return {
    calls,
    run: (providerResult: 'accepted' | 'rejected' | 'ambiguous', finalize = true) =>
      runLabelClaimOrchestration({
        claim: async () => ({ status: claimStatus, claimToken: 'claim-token' }),
        markSent: async () => { calls.markSent++; return true; },
        provider: async () => { calls.provider++; return providerResult; },
        finalize: async () => { calls.finalize++; return finalize; },
        rejected: async () => { calls.rejected++; return true; },
        orphan: async () => { calls.orphan++; return true; },
      }),
  };
}

test('blocks existing, active, orphan, and ineligible claims before the provider', async () => {
  for (const status of ['generated', 'claimed_conflict', 'orphan_pending', 'ineligible', 'not_found']) {
    const subject = harness(status);
    expect((await subject.run('accepted')).status).toBe(status);
    expect(subject.calls.provider).toBe(0);
  }
});

test('projects only the four Envia settings before strict configuration validation', () => {
  expect(projectEnviaShipmentConfiguration({ envia_carrier: 'paquetexpress', envia_service: 'express', envia_print_format: 'PDF', envia_print_size: 'A4', package_presets: {} })).toEqual({ envia_carrier: 'paquetexpress', envia_service: 'express', envia_print_format: 'PDF', envia_print_size: 'A4' });
});

test('sends exactly once only after a successful claim and mark-sent', async () => {
  const subject = harness();
  expect((await subject.run('accepted')).status).toBe('generated');
  expect(subject.calls).toEqual({ markSent: 1, provider: 1, finalize: 1, rejected: 0, orphan: 0 });
});

test('returns provider-accepted label data only after finalization succeeds', async () => {
  const accepted = {
    trackingNumber: 'TRACK-123',
    labelUrl: 'https://labels.example/123.pdf',
  };
  const result = await runLabelClaimOrchestration({
    claim: async () => ({ status: 'claimed', claimToken: 'claim-token' }),
    markSent: async () => true,
    provider: async () => ({ status: 'accepted' as const, accepted }),
    finalize: async (_token, finalized) => finalized === accepted,
    rejected: async () => true,
    orphan: async () => true,
  });

  expect(result).toEqual({ status: 'generated', accepted });
});

test('does not return provider-accepted label data when finalization fails', async () => {
  const result = await runLabelClaimOrchestration({
    claim: async () => ({ status: 'claimed', claimToken: 'claim-token' }),
    markSent: async () => true,
    provider: async () => ({
      status: 'accepted' as const,
      accepted: { trackingNumber: 'TRACK-123' },
    }),
    finalize: async () => false,
    rejected: async () => true,
    orphan: async () => true,
  });

  expect(result).toEqual({ status: 'orphan_pending' });
});

test('persists accepted rate evidence after claim and before marking generation sent', async () => {
  const calls: string[] = [];
  const result = await runLabelClaimOrchestration({
    claim: async () => ({ status: 'claimed', claimToken: 'claim-token' }),
    rateAndPersist: async () => { calls.push('rate'); return true; },
    markSent: async () => { calls.push('mark-sent'); return true; },
    provider: async () => { calls.push('provider'); return 'accepted'; },
    finalize: async () => { calls.push('finalize'); return true; },
    rejected: async () => true,
    orphan: async () => true,
  });

  expect(result.status).toBe('generated');
  expect(calls).toEqual(['rate', 'mark-sent', 'provider', 'finalize']);
});

test('releases a claimed shipment when rating cannot persist accepted evidence', async () => {
  let providerCalls = 0;
  const result = await runLabelClaimOrchestration({
    claim: async () => ({ status: 'claimed', claimToken: 'claim-token' }),
    rateAndPersist: async () => false,
    markSent: async () => true,
    provider: async () => { providerCalls++; return 'accepted'; },
    finalize: async () => true,
    rejected: async () => true,
    orphan: async () => true,
  });

  expect(result.status).toBe('rate_evidence_rejected');
  expect(providerCalls).toBe(0);
});

test('releases an unsent claim and reports retryable only when release persists', async () => {
  const subject = harness();
  const result = await runLabelClaimOrchestration({
    claim: async () => ({ status: 'claimed', claimToken: 'claim-token' }),
    markSent: async () => false,
    provider: async () => { subject.calls.provider++; return 'accepted'; },
    finalize: async () => true,
    rejected: async () => { subject.calls.rejected++; return true; },
    orphan: async () => true,
  });
  expect(result.status).toBe('mark_sent_released');
  expect(subject.calls.provider).toBe(0);
  expect(subject.calls.rejected).toBe(1);

  const failedRelease = await runLabelClaimOrchestration({
    claim: async () => ({ status: 'claimed', claimToken: 'claim-token' }),
    markSent: async () => false,
    provider: async () => { subject.calls.provider++; return 'accepted'; },
    finalize: async () => true,
    rejected: async () => false,
    orphan: async () => true,
  });
  expect(failedRelease.status).toBe('mark_sent_failed');
  expect(subject.calls.provider).toBe(0);
});

test('routes deterministic rejection and ambiguous results without retrying', async () => {
  const rejected = harness();
  expect((await rejected.run('rejected')).status).toBe('retryable_rejected');
  expect(rejected.calls).toEqual({ markSent: 1, provider: 1, finalize: 0, rejected: 1, orphan: 0 });

  const ambiguous = harness();
  expect((await ambiguous.run('ambiguous')).status).toBe('orphan_pending');
  expect(ambiguous.calls).toEqual({ markSent: 1, provider: 1, finalize: 0, rejected: 0, orphan: 1 });
});

test('reports failed rejection and orphan persistence without claiming a transition', async () => {
  const rejected = harness();
  const rejectedResult = await runLabelClaimOrchestration({
    claim: async () => ({ status: 'claimed', claimToken: 'claim-token' }), markSent: async () => true,
    provider: async () => { rejected.calls.provider++; return 'rejected'; }, finalize: async () => true,
    rejected: async () => false, orphan: async () => true,
  });
  expect(rejectedResult.status).toBe('rejected_state_persistence_failed');
  expect(rejected.calls.provider).toBe(1);

  const rejectedError = harness();
  expect((await runLabelClaimOrchestration({
    claim: async () => ({ status: 'claimed', claimToken: 'claim-token' }), markSent: async () => true,
    provider: async () => { rejectedError.calls.provider++; return 'rejected'; }, finalize: async () => true,
    rejected: async () => { throw new Error('rpc failure'); }, orphan: async () => true,
  })).status).toBe('rejected_state_persistence_failed');
  expect(rejectedError.calls.provider).toBe(1);

  const orphan = harness();
  const orphanResult = await runLabelClaimOrchestration({
    claim: async () => ({ status: 'claimed', claimToken: 'claim-token' }), markSent: async () => true,
    provider: async () => { orphan.calls.provider++; return 'ambiguous'; }, finalize: async () => true,
    rejected: async () => true, orphan: async () => { throw new Error('rpc failure'); },
  });
  expect(orphanResult.status).toBe('orphan_state_persistence_failed');
  expect(orphan.calls.provider).toBe(1);

  const finalizeFailure = harness();
  expect((await runLabelClaimOrchestration({
    claim: async () => ({ status: 'claimed', claimToken: 'claim-token' }), markSent: async () => true,
    provider: async () => { finalizeFailure.calls.provider++; return 'accepted'; }, finalize: async () => false,
    rejected: async () => true, orphan: async () => false,
  })).status).toBe('orphan_state_persistence_failed');
  expect(finalizeFailure.calls.provider).toBe(1);

  const finalizeError = harness();
  expect((await runLabelClaimOrchestration({
    claim: async () => ({ status: 'claimed', claimToken: 'claim-token' }), markSent: async () => true,
    provider: async () => { finalizeError.calls.provider++; return 'accepted'; }, finalize: async () => { throw new Error('rpc failure'); },
    rejected: async () => true, orphan: async () => true,
  })).status).toBe('orphan_pending');
  expect(finalizeError.calls.provider).toBe(1);
});

test('fails invalid ENV configuration before claim or provider calls', async () => {
  let claimCalls = 0;
  let providerCalls = 0;
  const result = await runLabelClaimOrchestration({
    preflight: async () => resolveEnviaRuntimeConfiguration({ ENVIA_MODE: 'sandbox' })
      ? null
      : 'configuration_invalid',
    claim: async () => { claimCalls++; return { status: 'claimed', claimToken: 'claim-token' }; },
    markSent: async () => true,
    provider: async () => { providerCalls++; return 'accepted'; },
    finalize: async () => true, rejected: async () => true, orphan: async () => true,
  });
  expect(result.status).toBe('configuration_invalid');
  expect(claimCalls).toBe(0);
  expect(providerCalls).toBe(0);
});

test('orphans a provider-accepted label when finalization fails', async () => {
  const subject = harness();
  expect((await subject.run('accepted', false)).status).toBe('orphan_pending');
  expect(subject.calls).toEqual({ markSent: 1, provider: 1, finalize: 1, rejected: 0, orphan: 1 });
});
