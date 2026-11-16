CREATE OR REPLACE FUNCTION public.fn_list_evidence_purge_candidates (
  p_limit integer
)
  RETURNS TABLE (
    order_id     uuid,
    object_names text[]
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'pg_temp'
  AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT';
  END IF;

  -- Retention (ops-cron-storage L2, L10, L12): 120 days after the order closed. An
  -- order closed when every shipment is completed, cancelled or refunded, at the
  -- latest greatest(completed_at, updated_at) of its shipments (greatest ignores
  -- NULL; a refund after completion keeps completed_at and moves updated_at); an
  -- order without shipments never closes (bool_and over no rows is NULL). Any dispute of the order whose
  -- status is not resolved or rejected (NULL included) holds its evidence.
  -- fn_mark_evidence_purged applies the same rule.
  RETURN QUERY
  WITH candidates AS (
    SELECT o.id, c.closed_at
    FROM public.orders AS o
    CROSS JOIN LATERAL (
      SELECT
        max(GREATEST(s.completed_at, s.updated_at)) AS closed_at,
        bool_and(s.status IN ('completed', 'cancelled', 'refunded')) AS all_closed
      FROM public.shipments AS s
      WHERE s.order_id = o.id
    ) AS c
    WHERE o.evidence_purged_at IS NULL
      AND c.all_closed
      AND c.closed_at < now() - interval '120 days'
      AND NOT EXISTS (
        SELECT 1
        FROM public.disputes AS d
        WHERE d.order_id = o.id
          AND (d.status IS NULL OR d.status NOT IN ('resolved', 'rejected'))
      )
    ORDER BY c.closed_at, o.id
    LIMIT p_limit
  )
  -- Evidence lives at <disputes|returns|shipments>/<order_id>/<uploader_id>/<file>.
  -- Each folder is a name range ('/' sorts right before '0' in "C"), so the
  -- (bucket_id, name COLLATE "C") index of storage.objects serves it.
  SELECT
    c.id,
    ARRAY(
      SELECT obj.name
      FROM unnest(ARRAY['disputes', 'returns', 'shipments']) AS f(folder)
      JOIN storage.objects AS obj
        ON obj.bucket_id = 'evidence'
       AND obj.name COLLATE "C" >= f.folder || '/' || c.id::text || '/'
       AND obj.name COLLATE "C" < f.folder || '/' || c.id::text || '0'
      ORDER BY obj.name COLLATE "C"
    )
  FROM candidates AS c
  ORDER BY c.closed_at, c.id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_list_evidence_purge_candidates"(integer) TO "service_role";

COMMENT ON FUNCTION "public"."fn_list_evidence_purge_candidates"(integer) IS 'Service-only (SECURITY DEFINER), for purge-old-evidence: up to p_limit (1-100) orders closed more than 120 days ago, with no open dispute and evidence_purged_at NULL, oldest closed first, each with the names of its objects in the evidence bucket (empty when it has none).';

REVOKE ALL ON FUNCTION "public"."fn_list_evidence_purge_candidates"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_list_evidence_purge_candidates"(integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_list_evidence_purge_candidates"(integer) FROM PUBLIC, "anon", "authenticated";
