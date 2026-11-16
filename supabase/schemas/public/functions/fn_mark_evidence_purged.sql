CREATE OR REPLACE FUNCTION public.fn_mark_evidence_purged (
  p_order_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'pg_temp'
  AS $function$
BEGIN
  -- Same retention rule as fn_list_evidence_purge_candidates (ops-cron-storage L2,
  -- L10, L12), checked again here: a shipment or dispute may have changed since the list.
  -- Marks only when no object of the order remains in the evidence bucket, so a run
  -- that failed halfway leaves the order unmarked and the next run finishes it.
  UPDATE public.orders AS o
  SET evidence_purged_at = now()
  WHERE o.id = p_order_id
    AND o.evidence_purged_at IS NULL
    AND (
      SELECT
        bool_and(s.status IN ('completed', 'cancelled', 'refunded'))
        AND max(GREATEST(s.completed_at, s.updated_at)) < now() - interval '120 days'
      FROM public.shipments AS s
      WHERE s.order_id = o.id
    ) IS TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM public.disputes AS d
      WHERE d.order_id = o.id
        AND (d.status IS NULL OR d.status NOT IN ('resolved', 'rejected'))
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(ARRAY['disputes', 'returns', 'shipments']) AS f(folder)
      JOIN storage.objects AS obj
        ON obj.bucket_id = 'evidence'
       AND obj.name COLLATE "C" >= f.folder || '/' || o.id::text || '/'
       AND obj.name COLLATE "C" < f.folder || '/' || o.id::text || '0'
    );

  RETURN FOUND;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_mark_evidence_purged"(uuid) TO "service_role";

COMMENT ON FUNCTION "public"."fn_mark_evidence_purged"(uuid) IS 'Service-only (SECURITY DEFINER), for purge-old-evidence: sets orders.evidence_purged_at when the order still meets the retention rule of fn_list_evidence_purge_candidates and none of its objects remain in the evidence bucket. Returns whether it marked; a second call returns false.';

REVOKE ALL ON FUNCTION "public"."fn_mark_evidence_purged"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_mark_evidence_purged"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_mark_evidence_purged"(uuid) FROM PUBLIC, "anon", "authenticated";
