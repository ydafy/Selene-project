import type { ProductCategory } from '@selene/types';

export type VerificationLoadState = 'loading' | 'ready' | 'error';

const BENCHMARK_CATEGORIES: readonly ProductCategory[] = ['GPU', 'CPU'];
const INFO_CATEGORIES: readonly ProductCategory[] = ['RAM', 'Motherboard'];

export function resolveVerificationRequirements(category: ProductCategory) {
  return {
    requiresBenchmark: BENCHMARK_CATEGORIES.includes(category),
    requiresInfo: INFO_CATEGORIES.includes(category),
  };
}

/** Submit stays unavailable until the product loaded and every required proof is present. */
export function canSubmitVerification(input: {
  loadState: VerificationLoadState;
  category: ProductCategory | null;
  physicalUri: string | null;
  performanceUri: string | null;
  score: string;
}): boolean {
  if (input.loadState !== 'ready' || !input.category || !input.physicalUri) {
    return false;
  }
  const { requiresBenchmark, requiresInfo } = resolveVerificationRequirements(
    input.category,
  );
  if (requiresBenchmark) {
    return !!input.performanceUri && input.score.trim() !== '';
  }
  if (requiresInfo) return !!input.performanceUri;
  return true;
}

/** Builds the stored proof payload; throws instead of writing an incomplete one. */
export function buildVerificationData(input: {
  category: ProductCategory;
  score: string;
  physicalPath: string | undefined;
  performancePath: string | undefined;
  submittedAt: string;
}) {
  const { requiresBenchmark, requiresInfo } = resolveVerificationRequirements(
    input.category,
  );
  if (
    !input.physicalPath ||
    ((requiresBenchmark || requiresInfo) && !input.performancePath)
  ) {
    throw new Error('VERIFICATION_PROOF_MISSING');
  }

  let benchmarkScore: number | null = null;
  if (requiresBenchmark) {
    benchmarkScore = Number(input.score);
    if (input.score.trim() === '' || !Number.isFinite(benchmarkScore)) {
      throw new Error('VERIFICATION_SCORE_INVALID');
    }
  }

  return {
    proof_physical: input.physicalPath,
    proof_performance: input.performancePath ?? null,
    benchmark_score: benchmarkScore,
    submitted_at: input.submittedAt,
  };
}

/** Error summary safe to log: no file paths, URIs, or user data. */
export function describeError(error: unknown) {
  if (error && typeof error === 'object') {
    const e = error as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
    };
    return {
      name: typeof e.name === 'string' ? e.name : undefined,
      message: typeof e.message === 'string' ? e.message : undefined,
      code: e.code,
      status: e.status ?? e.statusCode,
    };
  }
  return { message: String(error) };
}
