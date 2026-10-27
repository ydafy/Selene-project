/**
 * Expiring run lease for checkout-recovery-worker (BL13, odd/tasks/checkout-recovery-lease.md).
 * Replaces the global `checkout_recovery_running` boolean, which stayed true forever after a
 * killed run. The lease expires in the database after 600 seconds and is granted only while
 * `checkout_recovery_enabled` is true.
 */

type RpcResult = { data: unknown; error: unknown };

export interface CheckoutRecoveryLeaseClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
}

export type CheckoutRecoveryLease =
  | { acquired: true; leaseId: string }
  | { acquired: false };

const errorMessage = (error: unknown): string | undefined => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message: unknown };
    return typeof message === "string" ? message : undefined;
  }
  return undefined;
};

/**
 * Acquires the worker lease. Not acquired means another run holds it or recovery is disabled.
 * Throws `CHECKOUT_RECOVERY_LOCK_ACQUIRE_FAILED` (no work done) when the lease cannot be read.
 */
export async function acquireCheckoutRecoveryLease(
  client: CheckoutRecoveryLeaseClient,
): Promise<CheckoutRecoveryLease> {
  const { data, error } = await client.rpc(
    "fn_acquire_checkout_recovery_lease",
    {},
  );
  if (error) {
    throw new Error(
      `CHECKOUT_RECOVERY_LOCK_ACQUIRE_FAILED: ${errorMessage(error) ?? "UNKNOWN"}`,
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { acquired?: unknown; lease_id?: unknown }
    | null
    | undefined;
  if (!row || (row.acquired === true && typeof row.lease_id !== "string")) {
    throw new Error(
      "CHECKOUT_RECOVERY_LOCK_ACQUIRE_FAILED: INVALID_LEASE_RESPONSE",
    );
  }

  return row.acquired === true
    ? { acquired: true, leaseId: row.lease_id as string }
    : { acquired: false };
}

/** Releases the lease held by this run. Never throws: an unreleased lease expires on its own. */
export async function releaseCheckoutRecoveryLease(
  client: CheckoutRecoveryLeaseClient,
  leaseId: string,
  warn: (data: { leaseId: string; reason: string }) => void,
): Promise<void> {
  let reason: string | undefined;
  try {
    const { data, error } = await client.rpc(
      "fn_release_checkout_recovery_lease",
      { p_lease_id: leaseId },
    );
    if (error) reason = errorMessage(error) ?? "RELEASE_FAILED";
    else if (data !== true) reason = "NOT_HOLDER";
  } catch (error) {
    reason = errorMessage(error) ?? "RELEASE_FAILED";
  }
  if (reason) warn({ leaseId, reason });
}
