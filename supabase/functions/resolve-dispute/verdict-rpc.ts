type VerdictInput = {
  disputeId: string;
  verdict: 'buyer' | 'seller';
  adminNote: string;
};

/** Build dispatch only from validated verdict fields and an independently verified actor. */
export function buildVerdictRpc(input: VerdictInput, verifiedAdminId: string) {
  const args = { p_dispute_id: input.disputeId, p_admin_note: input.adminNote };
  if (input.verdict === 'seller') {
    return {
      name: 'fn_resolve_dispute_to_seller_as_admin',
      args: { ...args, p_admin_id: verifiedAdminId },
    };
  }
  return {
    name: 'fn_resolve_dispute_to_buyer_as_admin',
    args: { ...args, p_admin_id: verifiedAdminId },
  };
}
