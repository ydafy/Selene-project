import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildVerificationData,
  canSubmitVerification,
  resolveVerificationRequirements,
} from '../../core/utils/verification-submit';

const FRONTEND = join(import.meta.dir, '..', '..');
const read = (path: string) => readFileSync(join(FRONTEND, path), 'utf8');
const flat = (path: string) => read(path).replace(/\s+/g, ' ');
const hook = flat('core/hooks/useVerificationLogic.ts');
const screen = flat('app/verify/[id].tsx');
const success = flat('app/sell/success.tsx');
const es = JSON.parse(read('core/i18n/locales/es/verify.json'));
const en = JSON.parse(read('core/i18n/locales/en/verify.json'));

const ready = {
  loadState: 'ready' as const,
  physicalUri: 'file:///physical.jpg',
  performanceUri: 'file:///bench.jpg',
  score: '12000',
};

describe('verification requirements', () => {
  it('requires a benchmark for GPU and CPU and info for RAM and Motherboard', () => {
    expect(resolveVerificationRequirements('GPU')).toEqual({ requiresBenchmark: true, requiresInfo: false });
    expect(resolveVerificationRequirements('CPU')).toEqual({ requiresBenchmark: true, requiresInfo: false });
    expect(resolveVerificationRequirements('RAM')).toEqual({ requiresBenchmark: false, requiresInfo: true });
    expect(resolveVerificationRequirements('Motherboard')).toEqual({ requiresBenchmark: false, requiresInfo: true });
  });
});

describe('canSubmitVerification', () => {
  it('blocks submit until the product has loaded', () => {
    expect(canSubmitVerification({ ...ready, loadState: 'loading', category: 'GPU' })).toBe(false);
    expect(canSubmitVerification({ ...ready, loadState: 'error', category: 'GPU' })).toBe(false);
  });

  it('blocks submit when the category is unknown instead of relaxing the requirements', () => {
    expect(canSubmitVerification({ ...ready, category: null, performanceUri: null, score: '' })).toBe(false);
  });

  it('requires the physical proof for every category', () => {
    expect(canSubmitVerification({ ...ready, category: 'GPU', physicalUri: null })).toBe(false);
  });

  it('requires performance proof and a score for GPU and CPU', () => {
    expect(canSubmitVerification({ ...ready, category: 'GPU' })).toBe(true);
    expect(canSubmitVerification({ ...ready, category: 'GPU', performanceUri: null })).toBe(false);
    expect(canSubmitVerification({ ...ready, category: 'CPU', score: '  ' })).toBe(false);
  });

  it('requires info proof but no score for RAM and Motherboard', () => {
    expect(canSubmitVerification({ ...ready, category: 'RAM', score: '' })).toBe(true);
    expect(canSubmitVerification({ ...ready, category: 'Motherboard', performanceUri: null })).toBe(false);
  });
});

describe('buildVerificationData', () => {
  const base = { submittedAt: '2026-10-21T00:00:00.000Z' };

  it('builds benchmark data for GPU', () => {
    expect(
      buildVerificationData({ ...base, category: 'GPU', score: '12000', physicalPath: 'p/1.jpg', performancePath: 'p/2.jpg' }),
    ).toEqual({
      proof_physical: 'p/1.jpg',
      proof_performance: 'p/2.jpg',
      benchmark_score: 12000,
      submitted_at: base.submittedAt,
    });
  });

  it('stores no score for info categories', () => {
    expect(
      buildVerificationData({ ...base, category: 'RAM', score: '', physicalPath: 'p/1.jpg', performancePath: 'p/2.jpg' })
        .benchmark_score,
    ).toBeNull();
  });

  it('refuses to write data with a missing required proof', () => {
    expect(() =>
      buildVerificationData({ ...base, category: 'GPU', score: '1', physicalPath: undefined, performancePath: 'p/2.jpg' }),
    ).toThrow('VERIFICATION_PROOF_MISSING');
    expect(() =>
      buildVerificationData({ ...base, category: 'RAM', score: '', physicalPath: 'p/1.jpg', performancePath: undefined }),
    ).toThrow('VERIFICATION_PROOF_MISSING');
  });

  it('refuses a non-numeric benchmark score', () => {
    expect(() =>
      buildVerificationData({ ...base, category: 'CPU', score: 'abc', physicalPath: 'p/1.jpg', performancePath: 'p/2.jpg' }),
    ).toThrow('VERIFICATION_SCORE_INVALID');
  });
});

describe('verification hook fails closed', () => {
  it('tracks the product load state and exposes a reload', () => {
    expect(hook).toContain("useState<VerificationLoadState>('loading')");
    expect(hook).toContain("setLoadState('error')");
    expect(hook).toContain('reload');
  });

  it('aborts when the current verification data cannot be re-read', () => {
    expect(hook).toContain('if (readError) throw readError;');
  });

  it('treats an update that changes no row as a failure', () => {
    expect(hook).toContain(".select('id')");
    expect(hook).toContain("throw new Error('VERIFICATION_UPDATE_NO_ROW')");
  });

  it('guards submit against concurrent taps with a ref', () => {
    expect(hook).toContain("if (submittingRef.current) return 'BUSY';");
    expect(hook).toContain("throw new Error('VERIFICATION_NOT_READY')");
  });

  it('logs the real error without file paths', () => {
    expect(hook).toContain("console.error('[verification] submit failed', describeError(error))");
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
    expect(success).toContain('if (!productId || navigatingRef.current) return;');
    expect(success).toContain('if (navigatingRef.current) return;');
    expect(success).toContain('disabled={!productId || isNavigating}');
    expect(success).toContain('loading={isNavigating}');
  });
});
