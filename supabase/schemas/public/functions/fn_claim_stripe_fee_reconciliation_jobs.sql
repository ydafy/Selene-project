CREATE OR REPLACE FUNCTION public.fn_claim_stripe_fee_reconciliation_jobs (
  p_limit integer DEFAULT 25
)
  RETURNS SETOF public.stripe_fee_reconciliation_jobs
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'STRIPE_FEE_LEASE_REQUIRED' USING ERRCODE = 'P0001';
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs"(integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs"(integer) FROM PUBLIC, "anon", "authenticated";
