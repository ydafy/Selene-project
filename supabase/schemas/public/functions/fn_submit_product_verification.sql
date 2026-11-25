CREATE OR REPLACE FUNCTION public.fn_submit_product_verification (
  p_product_id        uuid,
  p_physical_paths    text[],
  p_performance_paths text[]  DEFAULT '{}'::text[],
  p_benchmark_score   integer DEFAULT NULL::integer
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_seller_id uuid;
  v_status public.product_status;
  v_deleted_at timestamptz;
  v_hold public.product_status;
  v_physical text[] := COALESCE(p_physical_paths, '{}'::text[]);
  v_performance text[] := COALESCE(p_performance_paths, '{}'::text[]);
  v_verification_id uuid;
BEGIN
  -- The seller sends a listing to review (odd/tasks/verification-history.md
  -- S3): one attempt with its proofs, each a file the seller uploaded to the
  -- listing's folder of bucket verification.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
  END IF;

  IF NOT public.fn_current_account_is_active() THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_ACTIVE';
  END IF;

  SELECT p.seller_id, p.status, p.deleted_at, p.status_before_account_hold
  INTO v_seller_id, v_status, v_deleted_at, v_hold
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  IF NOT FOUND OR v_seller_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF v_deleted_at IS NOT NULL
    OR v_hold IS NOT NULL
    OR v_status NOT IN ('pending_verification'::public.product_status, 'rejected'::public.product_status) THEN
    RAISE EXCEPTION 'INVALID_STATUS_FOR_VERIFICATION';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.product_verifications v
    WHERE v.product_id = p_product_id AND v.decision IS NULL
  ) THEN
    RAISE EXCEPTION 'VERIFICATION_ALREADY_OPEN';
  END IF;

  IF cardinality(v_physical) = 0 THEN
    RAISE EXCEPTION 'PHYSICAL_PROOF_REQUIRED';
  END IF;

  IF p_benchmark_score < 0 THEN
    RAISE EXCEPTION 'INVALID_BENCHMARK_SCORE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_physical || v_performance) AS e(path)
    WHERE (starts_with(e.path, p_product_id::text || '/') AND strpos(e.path, '..') = 0) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'INVALID_EVIDENCE_PATH';
  END IF;

  IF (SELECT count(DISTINCT e.path) FROM unnest(v_physical || v_performance) AS e(path))
     <> cardinality(v_physical || v_performance) THEN
    RAISE EXCEPTION 'DUPLICATE_EVIDENCE_PATH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_physical || v_performance) AS e(path)
    WHERE NOT EXISTS (
      SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'verification' AND o.name = e.path
    )
  ) THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_FOUND';
  END IF;

  INSERT INTO public.product_verifications (product_id, submitted_by, benchmark_score)
  VALUES (p_product_id, v_caller, p_benchmark_score)
  RETURNING id INTO v_verification_id;

  INSERT INTO public.product_verification_evidence (verification_id, kind, storage_path)
  SELECT v_verification_id, 'physical'::public.verification_evidence_kind, e.path
  FROM unnest(v_physical) AS e(path)
  UNION ALL
  SELECT v_verification_id, 'performance'::public.verification_evidence_kind, e.path
  FROM unnest(v_performance) AS e(path);

  UPDATE public.products
  SET status = 'in_review'::public.product_status
  WHERE id = p_product_id;

  RETURN v_verification_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_submit_product_verification"(uuid, text[], text[], integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."fn_submit_product_verification"(uuid, text[], text[], integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_submit_product_verification"(uuid, text[], text[], integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_submit_product_verification"(uuid, text[], text[], integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_submit_product_verification"(uuid, text[], text[], integer) FROM PUBLIC, "anon";
