import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildVerificationSubmission,
  canSubmitVerification,
  readLatestAttempt,
  resolveVerificationRequirements,
  verificationErrorMessage,
} from './verification-submit';

const FRONTEND = join(import.meta.dir, '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8');
const flat = (path: string) => read(path).replace(/\s+/g, ' ');
const hook = flat('src/features/verify/hooks/use-verification-logic.ts');
const screen = flat('src/app/verify/[id].tsx');
const success = flat('src/app/sell/success.tsx');
const es = JSON.parse(read('src/shared/i18n/locales/es/verify.json'));
const en = JSON.parse(read('src/shared/i18n/locales/en/verify.json'));

const ready = {
  loadState: 'ready' as const,
  physicalUri: 'file:///physical.jpg',
  performanceUri: 'file:///bench.jpg',
  score: '12000',
};

describe('verification requirements', () => {
  it('requires a benchmark for GPU and CPU and info for RAM and Motherboard', () => {
    expect(resolveVerificationRequirements('GPU')).toEqual({
      requiresBenchmark: true,
      requiresInfo: false,
    });
    expect(resolveVerificationRequirements('CPU')).toEqual({
      requiresBenchmark: true,
      requiresInfo: false,
    });
    expect(resolveVerificationRequirements('RAM')).toEqual({
      requiresBenchmark: false,
      requiresInfo: true,
    });
    expect(resolveVerificationRequirements('Motherboard')).toEqual({
      requiresBenchmark: false,
      requiresInfo: true,
    });
  });
});

describe('canSubmitVerification', () => {
  it('blocks submit until the product has loaded', () => {
    expect(
      canSubmitVerification({
        ...ready,
        loadState: 'loading',
        category: 'GPU',
      }),
    ).toBe(false);
    expect(
      canSubmitVerification({ ...ready, loadState: 'error', category: 'GPU' }),
    ).toBe(false);
  });

  it('blocks submit when the category is unknown instead of relaxing the requirements', () => {
    expect(
      canSubmitVerification({
        ...ready,
        category: null,
        performanceUri: null,
        score: '',
      }),
    ).toBe(false);
  });

  it('requires the physical proof for every category', () => {
    expect(
      canSubmitVerification({ ...ready, category: 'GPU', physicalUri: null }),
    ).toBe(false);
  });

  it('requires performance proof and a score for GPU and CPU', () => {
    expect(canSubmitVerification({ ...ready, category: 'GPU' })).toBe(true);
    expect(
      canSubmitVerification({
        ...ready,
        category: 'GPU',
        performanceUri: null,
      }),
    ).toBe(false);
    expect(
      canSubmitVerification({ ...ready, category: 'CPU', score: '  ' }),
    ).toBe(false);
  });

  it('requires info proof but no score for RAM and Motherboard', () => {
    expect(
      canSubmitVerification({ ...ready, category: 'RAM', score: '' }),
    ).toBe(true);
    expect(
      canSubmitVerification({
        ...ready,
        category: 'Motherboard',
        performanceUri: null,
      }),
    ).toBe(false);
  });
});

describe('buildVerificationSubmission', () => {
  const productId = 'prod-1';

  it('builds the submit RPC arguments for GPU with a whole-number score', () => {
    expect(
      buildVerificationSubmission({
        productId,
        category: 'GPU',
        score: ' 12000 ',
        physicalPath: 'prod-1/physical_1.jpg',
        performancePath: 'prod-1/bench_1.jpg',
      }),
    ).toEqual({
      p_product_id: productId,
      p_physical_paths: ['prod-1/physical_1.jpg'],
      p_performance_paths: ['prod-1/bench_1.jpg'],
      p_benchmark_score: 12000,
    });
  });

  it('sends no score for info categories', () => {
    expect(
      buildVerificationSubmission({
        productId,
        category: 'RAM',
        score: '999',
        physicalPath: 'prod-1/physical_1.jpg',
        performancePath: 'prod-1/info_1.jpg',
      }),
    ).toEqual({
      p_product_id: productId,
      p_physical_paths: ['prod-1/physical_1.jpg'],
      p_performance_paths: ['prod-1/info_1.jpg'],
    });
  });

  it('refuses to submit with a missing required proof', () => {
    expect(() =>
      buildVerificationSubmission({
        productId,
        category: 'GPU',
        score: '1',
        physicalPath: undefined,
        performancePath: 'prod-1/bench_1.jpg',
      }),
    ).toThrow('VERIFICATION_PROOF_MISSING');
    expect(() =>
      buildVerificationSubmission({
        productId,
        category: 'RAM',
        score: '',
        physicalPath: 'prod-1/physical_1.jpg',
        performancePath: undefined,
      }),
    ).toThrow('VERIFICATION_PROOF_MISSING');
  });

  it('refuses a score that is not a non-negative whole number', () => {
    for (const score of ['abc', '', '12.5', '-1', '1e3', '2147483648']) {
      expect(() =>
        buildVerificationSubmission({
          productId,
          category: 'CPU',
          score,
          physicalPath: 'prod-1/physical_1.jpg',
          performancePath: 'prod-1/bench_1.jpg',
        }),
      ).toThrow('VERIFICATION_SCORE_INVALID');
    }
  });
});

describe('readLatestAttempt', () => {
  it('reads nothing when the listing has no attempt', () => {
    expect(readLatestAttempt(null)).toEqual({
      rejectionReason: null,
      benchmarkScore: null,
      physicalPath: undefined,
      performancePath: undefined,
    });
  });

  it('takes the rejection reason and proofs of a rejected attempt', () => {
    expect(
      readLatestAttempt({
        decision: 'rejected',
        public_note: 'La foto está borrosa',
        benchmark_score: 12000,
        product_verification_evidence: [
          { kind: 'performance', storage_path: 'prod-1/bench_1.jpg' },
          { kind: 'physical', storage_path: 'prod-1/physical_1.jpg' },
        ],
      }),
    ).toEqual({
      rejectionReason: 'La foto está borrosa',
      benchmarkScore: 12000,
      physicalPath: 'prod-1/physical_1.jpg',
      performancePath: 'prod-1/bench_1.jpg',
    });
  });

  it('shows no rejection reason for an open or approved attempt', () => {
    for (const decision of [null, 'approved'] as const) {
      expect(
        readLatestAttempt({
          decision,
          public_note: 'note',
          benchmark_score: null,
          product_verification_evidence: [],
        }).rejectionReason,
      ).toBeNull();
    }
  });
});

describe('verificationErrorMessage', () => {
  const t = (key: string) => `t(${key})`;
  const rpcError = (message: string) => ({
    code: 'P0001',
    message,
    details: null,
    hint: null,
  });
  const cases: Record<string, string> = {
    UNAUTHORIZED: 'errors.notOwner',
    ACCOUNT_NOT_ACTIVE: 'errors.accountNotActive',
    INVALID_STATUS_FOR_VERIFICATION: 'errors.invalidStatus',
    VERIFICATION_ALREADY_OPEN: 'errors.alreadyOpen',
    PHYSICAL_PROOF_REQUIRED: 'errors.physicalProofRequired',
    INVALID_EVIDENCE_PATH: 'errors.evidenceMissing',
    EVIDENCE_NOT_FOUND: 'errors.evidenceMissing',
    DUPLICATE_EVIDENCE_PATH: 'errors.duplicateEvidence',
    INVALID_BENCHMARK_SCORE: 'errors.invalidScore',
  };

  it('maps each submit RPC error code to its message', () => {
    for (const [code, key] of Object.entries(cases)) {
      expect(verificationErrorMessage(rpcError(code), t)).toBe(`t(${key})`);
    }
  });

  it('maps a score the app refused to the invalid score message', () => {
    expect(
      verificationErrorMessage(new Error('VERIFICATION_SCORE_INVALID'), t),
    ).toBe('t(errors.invalidScore)');
  });

  it('maps any other error to the generic message without leaking it', () => {
    const raw = 'new row violates row-level security policy';
    expect(verificationErrorMessage({ code: '42501', message: raw }, t)).toBe(
      't(alerts.errorMessage)',
    );
    expect(
      verificationErrorMessage({ code: '42501', message: 'UNAUTHORIZED' }, t),
    ).toBe('t(alerts.errorMessage)');
    expect(verificationErrorMessage(new Error('boom'), t)).toBe(
      't(alerts.errorMessage)',
    );
    expect(verificationErrorMessage(undefined, t)).toBe(
      't(alerts.errorMessage)',
    );
  });

  it('has every message in English and Spanish', () => {
    for (const key of new Set(Object.values(cases))) {
      const leaf = key.replace('errors.', '');
      expect(en.errors[leaf]).toBeString();
      expect(es.errors[leaf]).toBeString();
    }
  });
});

describe('verification hook fails closed', () => {
  it('tracks the product load state and exposes a reload', () => {
    expect(hook).toContain("useState<VerificationLoadState>('loading')");
    expect(hook).toContain("setLoadState('error')");
    expect(hook).toContain('reload');
  });

  it('resubmits the proof paths of the attempt the form displayed, never a re-read one', () => {
    // The only read of the latest attempt is the load; submit reuses its paths.
    expect(hook.split('fetchLatestAttempt(').length - 1).toBe(1);
    expect(hook).toContain(
      'let physicalPath = displayedProofs.current.physicalPath;',
    );
    expect(hook).toContain(
      'let performancePath = displayedProofs.current.performancePath;',
    );
  });

  it('fails the load when the latest attempt cannot be read', () => {
    expect(hook).toContain(".from('product_verifications')");
    expect(hook).toContain('if (attemptError)');
  });

  it('submits through the RPC, never a plain products update', () => {
    expect(hook).toContain(".rpc( 'fn_submit_product_verification',");
    expect(hook).not.toContain('.update(');
  });

  it('treats an RPC that returns no attempt as a failure', () => {
    expect(hook).toContain("throw new Error('VERIFICATION_SUBMIT_NO_ATTEMPT')");
  });

  it('no longer reads or writes the dropped products columns', () => {
    for (const column of [
      'verification_data',
      'rejection_reason',
      'verified_at',
      'locked_by',
      'locked_at',
    ]) {
      expect(hook).not.toContain(column);
    }
  });

  it('guards submit against concurrent taps with a ref', () => {
    expect(hook).toContain("if (submittingRef.current) return 'BUSY';");
    expect(hook).toContain("throw new Error('VERIFICATION_NOT_READY')");
  });

  it('logs the real error without file paths', () => {
    expect(hook).toContain(
      "console.error('[verification] submit failed', describeError(error))",
    );
  });
});

describe('verification screen', () => {
  it('shows a loading state and a retryable error instead of a blank or relaxed form', () => {
    expect(screen).toContain("if (loadState === 'loading')");
    expect(screen).toContain('<ActivityIndicator');
    expect(screen).toContain("if (loadState === 'error' || !category)");
    expect(screen).toContain("t('load.retry')");
    expect(screen).toContain('onPress={reload}');
  });

  it('uses the shared submit rule', () => {
    expect(screen).toContain('canSubmitVerification({');
  });

  it('shows success only for a confirmed submission', () => {
    expect(screen).toContain("if (result !== 'SUCCESS') return;");
  });

  it('shows the mapped submit error instead of a generic one', () => {
    expect(screen).toContain(
      'description: verificationErrorMessage(error, t),',
    );
  });

  it('translates the camera permission dialog', () => {
    expect(screen).not.toContain('Permiso Requerido');
    expect(screen).toContain("t('alerts.permissionTitle')");
    expect(es.alerts.permissionTitle).toBe('Permiso requerido');
    expect(es.alerts.permissionMessage).toBe(
      'Necesitamos acceso a la cámara para verificar el producto.',
    );
    expect(en.alerts.permissionTitle).toBe('Permission required');
    expect(en.alerts.permissionMessage).toBe(
      'We need camera access to verify the product.',
    );
  });

  it('localizes the load error', () => {
    expect(es.load).toEqual({
      errorTitle: 'No pudimos cargar tu producto',
      errorMessage: 'Revisa tu conexión e intenta de nuevo.',
      retry: 'Reintentar',
    });
    expect(en.load).toEqual({
      errorTitle: 'We could not load your product',
      errorMessage: 'Check your connection and try again.',
      retry: 'Retry',
    });
  });
});

describe('sell success handoff', () => {
  it('guards navigation with a ref and disables the buttons while navigating', () => {
    expect(success).toContain(
      'if (!productId || navigatingRef.current) return;',
    );
    expect(success).toContain('if (navigatingRef.current) return;');
    expect(success).toContain('disabled={!productId || isNavigating}');
    expect(success).toContain('loading={isNavigating}');
  });
});
