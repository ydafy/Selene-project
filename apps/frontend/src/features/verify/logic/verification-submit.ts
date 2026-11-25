import type { Enums, ProductCategory } from '@selene/types';
export { describeError } from '@/shared/utils/describe-error';

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

// product_verifications.benchmark_score is a Postgres integer.
const MAX_BENCHMARK_SCORE = 2_147_483_647;

/**
 * Builds the arguments of fn_submit_product_verification (#651 S3); throws
 * instead of submitting an incomplete attempt. Paths are object names in
 * bucket verification (`<product_id>/<file>`).
 */
export function buildVerificationSubmission(input: {
  productId: string;
  category: ProductCategory;
  score: string;
  physicalPath: string | undefined;
  performancePath: string | undefined;
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

  const args = {
    p_product_id: input.productId,
    p_physical_paths: [input.physicalPath],
    p_performance_paths: input.performancePath ? [input.performancePath] : [],
  };
  if (!requiresBenchmark) return args;

  const score = input.score.trim();
  const benchmarkScore = Number(score);
  if (!/^\d+$/.test(score) || benchmarkScore > MAX_BENCHMARK_SCORE) {
    throw new Error('VERIFICATION_SCORE_INVALID');
  }
  return { ...args, p_benchmark_score: benchmarkScore };
}

/** The latest attempt as the owner reads it from product_verifications. */
export type LatestVerificationAttempt = {
  decision: Enums<'product_verification_decision'> | null;
  public_note: string | null;
  benchmark_score: number | null;
  product_verification_evidence: {
    kind: Enums<'verification_evidence_kind'>;
    storage_path: string;
  }[];
};

/**
 * What the verification screen shows from the latest attempt: the reason of a
 * rejection and the proofs a resubmission keeps when the seller does not
 * retake them.
 */
export function readLatestAttempt(attempt: LatestVerificationAttempt | null) {
  const evidence = attempt?.product_verification_evidence ?? [];
  return {
    rejectionReason:
      attempt?.decision === 'rejected' ? attempt.public_note : null,
    benchmarkScore: attempt?.benchmark_score ?? null,
    physicalPath: evidence.find((e) => e.kind === 'physical')?.storage_path,
    performancePath: evidence.find((e) => e.kind === 'performance')
      ?.storage_path,
  };
}

// P0001 codes raised by fn_submit_product_verification, plus the app's own
// score check, mapped to verify.json copy.
const SUBMIT_ERROR_KEYS: Record<string, string> = {
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

/**
 * Maps a failed submission to user-facing copy (namespace verify). The raw
 * error never reaches the user; the hook keeps it in its log.
 */
export function verificationErrorMessage(
  error: unknown,
  t: (key: string) => string,
): string {
  const { code, message } =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown; message?: unknown })
      : {};
  if (typeof message === 'string') {
    if (code === 'P0001' && Object.hasOwn(SUBMIT_ERROR_KEYS, message)) {
      return t(SUBMIT_ERROR_KEYS[message]);
    }
    if (error instanceof Error && message === 'VERIFICATION_SCORE_INVALID') {
      return t('errors.invalidScore');
    }
  }
  return t('alerts.errorMessage');
}
