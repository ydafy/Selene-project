import { atomicResumeMappingArgs, ConnectPayoutReleaseError } from './release-connect-payout.ts';
import type { AtomicResumeMappingArgs, ConnectPayoutReleaseDependencies } from './release-connect-payout.ts';

export type AtomicResumeRpc = (
  name: 'fn_atomic_payout_resume_mapping',
  args: AtomicResumeMappingArgs,
) => PromiseLike<{ data: unknown; error: unknown }>;

/** NULL/false/malformed response is a refusal; no dependent write. */
export function createAtomicResumeAdapters(rpc: AtomicResumeRpc): Pick<
  ConnectPayoutReleaseDependencies, 'markRunRetrying' | 'markRunPendingReconciliation'
> {
  return {
    markRunRetrying: async (input) => {
      const { data, error } = await rpc(
        'fn_atomic_payout_resume_mapping', atomicResumeMappingArgs(input, 'retry'),
      );
      if (error) throw new ConnectPayoutReleaseError('RUN_RETRY_MARK_FAILED', 500);
      return typeof data === 'number' && Number.isSafeInteger(data) && data > 0 ? data : null;
    },
    markRunPendingReconciliation: async (input) => {
      const { data, error } = await rpc(
        'fn_atomic_payout_resume_mapping', atomicResumeMappingArgs(input, 'pending'),
      );
      if (error) throw new ConnectPayoutReleaseError('RUN_UPDATE_FAILED', 500);
      return typeof data === 'number' && Number.isSafeInteger(data) && data > 0 ? data : null;
    },
  };
}
