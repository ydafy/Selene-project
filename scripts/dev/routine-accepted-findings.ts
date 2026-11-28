// Remote advisor lints the maintainer accepted, so the weekly routine stops
// asking about them (docs/maintenance.md, "Accepted findings"). routine-collect
// compares `supabase db advisors --remote` with this list, plus the local CI list
// in scripts/ci/security-advisor-exceptions.ts, and prints only what changed: a
// new object, a lint with no entry, or an accepted object that is gone.
// Add or widen an entry only with the maintainer's decision and a reason; remove
// an object when the issue that fixes it merges.

export type AcceptedAdvisorLint = {
  type: 'security' | 'performance';
  lint: string;
  // The advisor `cacheKey` of each accepted object, or 'all' when every object
  // of the lint, including a new one, is accepted.
  objects: string[] | 'all';
  reason: string;
  trackedBy?: string;
};

const fn = (role: 'anon' | 'authenticated', signature: string) =>
  `${role}_security_definer_function_executable_public_${signature}`;

export const ACCEPTED_REMOTE_FINDINGS: AcceptedAdvisorLint[] = [
  {
    type: 'security',
    lint: 'rls_enabled_no_policy',
    objects: [
      'public_connect_payout_runs',
      'public_connect_payout_run_shipments',
      'public_shipment_cancellation_operations',
      'public_shipment_completion_events',
      'public_shipment_payout_hold_notes',
      'public_push_tokens',
      'public_push_deliveries',
      'public_push_event_policy',
      'internal_account_closures',
      'internal_checkout_recovery_shells',
      'internal_connect_account_actionability',
      'internal_connect_account_events',
      'internal_connect_payout_events',
      'internal_cron_http_requests',
      'internal_cron_leases',
      'internal_ops_failures',
      'internal_stripe_fee_reconciliation_jobs',
      'internal_webhook_deliveries',
    ].map((table) => `rls_enabled_no_policy_${table}`),
    reason:
      'Server-owned records that server code reaches through RPCs and the service role. Each table file revokes all from anon and authenticated, and only service_role has USAGE on internal. No client policy is intended (odd/tasks/internal-schema.md, S3; odd/tasks/held-payout-overdue-refund.md, T1).',
  },
  {
    type: 'security',
    lint: 'anon_security_definer_function_executable',
    objects: [
      fn('anon', 'is_admin_'),
      fn('anon', 'fn_product_seller_payment_readiness_p_product_ids uuid[]'),
      fn('anon', 'fn_unregister_push_token_p_token text'),
    ],
    reason:
      'Each function file in supabase/schemas/public/functions/ grants EXECUTE per role (#305, odd/tasks/explicit-role-grants.md, L11). RLS policies call is_admin; guests reach the readiness check and the pending push unregister.',
    trackedBy: '#434',
  },
  {
    type: 'security',
    lint: 'authenticated_security_definer_function_executable',
    objects: [
      fn('authenticated', 'is_admin_'),
      fn(
        'authenticated',
        'fn_product_seller_payment_readiness_p_product_ids uuid[]',
      ),
      fn('authenticated', 'fn_unregister_push_token_p_token text'),
      fn('authenticated', 'fn_current_account_is_active_'),
      fn(
        'authenticated',
        'fn_register_push_token_p_token text, p_platform text',
      ),
      fn(
        'authenticated',
        'fn_get_shipment_cancellation_summary_p_shipment_id uuid',
      ),
      fn(
        'authenticated',
        'fn_seller_submit_return_evidence_p_dispute_id uuid, p_images text[], p_video_url text',
      ),
      fn(
        'authenticated',
        'fn_lock_product_p_product_id uuid, p_verification_id uuid',
      ),
      fn('authenticated', 'fn_unlock_product_p_product_id uuid'),
      fn(
        'authenticated',
        'fn_resolve_product_verdict_p_product_id uuid, p_verification_id uuid, p_verdict text, p_public_note text, p_private_note text',
      ),
      fn('authenticated', 'fn_admin_restore_product_p_product_id uuid'),
      fn(
        'authenticated',
        'fn_admin_soft_delete_product_p_product_id uuid, p_reason text',
      ),
      fn(
        'authenticated',
        'fn_admin_toggle_verified_seller_p_target_user_id uuid, p_is_verified boolean',
      ),
      fn(
        'authenticated',
        'fn_admin_update_user_status_p_target_user_id uuid, p_new_status public.account_status, p_reason text',
      ),
      fn(
        'authenticated',
        'fn_submit_product_verification_p_product_id uuid, p_physical_paths text[], p_performance_paths text[], p_benchmark_score integer',
      ),
    ],
    reason:
      'Each function file in supabase/schemas/public/functions/ grants EXECUTE per role (#305, odd/tasks/explicit-role-grants.md, L11). The apps call these RPCs, RLS policies call is_admin and fn_current_account_is_active, and the admin RPCs check is_admin() in their body. fn_submit_product_verification (accepted 2026-11-28) checks the session, an active account, and that the caller owns the product; the verification tables are read-only for clients, so the seller writes only through it.',
    trackedBy: '#434',
  },
  {
    type: 'security',
    lint: 'auth_leaked_password_protection',
    objects: ['auth_leaked_password_protection'],
    reason:
      'Needs the Pro plan. This project stays on Free as staging (#313, decided 2026-11-26); production enables it when it is created (docs/go-live.md, leaked password protection step).',
  },
  {
    type: 'performance',
    lint: 'unused_index',
    objects: 'all',
    reason:
      'Unused indexes mean nothing on test data, so the whole lint is accepted: a new unused index is not a decision either. Reviewed after real traffic.',
  },
];
