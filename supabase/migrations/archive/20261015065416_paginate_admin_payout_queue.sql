-- Group-first pagination and explicit complete selection for the admin queue.
-- Read only: selection is a review input, never payout/retry authorization.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_get_admin_payout_queue(
  p_search TEXT DEFAULT '',
  p_bucket TEXT DEFAULT 'ready',
  p_page INTEGER DEFAULT 0,
  p_scope TEXT DEFAULT 'page'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_search TEXT := btrim(COALESCE(p_search, ''));
  v_result JSONB;
BEGIN
  IF p_bucket IS NULL OR p_bucket NOT IN ('ready', 'processing', 'action-required', 'history') THEN
    RAISE EXCEPTION 'INVALID_QUEUE_BUCKET';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('page', 'selection') THEN
    RAISE EXCEPTION 'INVALID_QUEUE_SCOPE';
  END IF;
  IF p_page IS NULL OR p_page < 0 THEN
    RAISE EXCEPTION 'INVALID_QUEUE_PAGE';
  END IF;
  IF p_scope = 'selection' AND p_bucket NOT IN ('ready', 'action-required') THEN
    RAISE EXCEPTION 'QUEUE_SELECTION_NOT_ALLOWED';
  END IF;

  WITH queue_rows AS MATERIALIZED (
    SELECT q.*,
      to_jsonb(q) AS row_data,
      CASE WHEN q.payout_run_id IS NULL
        THEN 'seller:' || q.seller_id::TEXT
        ELSE 'run:' || q.payout_run_id::TEXT END AS queue_group_id,
      CASE WHEN q.payout_run_id IS NULL THEN 0
        WHEN q.payout_run_status = 'paid' THEN 1
        WHEN q.payout_run_status = 'pending_reconciliation' THEN 2
        ELSE 3 END AS bucket_rank
    FROM public.admin_connect_payout_release_view q
    WHERE (q.payout_run_id IS NOT NULL OR
      (q.seller_id IS NOT NULL AND q.shipment_id IS NOT NULL AND q.order_id IS NOT NULL))
      AND (v_search = '' OR strpos(lower(COALESCE(q.seller_name, '')), lower(v_search)) > 0)
  ), groups AS (
    SELECT queue_group_id,
      CASE MAX(bucket_rank) WHEN 0 THEN 'ready' WHEN 1 THEN 'history'
        WHEN 2 THEN 'processing' ELSE 'action-required' END AS bucket,
      MIN(seller_name) AS seller_name,
      MAX(payout_run_paid_at) AS paid_at,
      CASE WHEN MAX(bucket_rank) = 0 THEN
        BOOL_OR(is_eligible IS TRUE AND release_amount_cents > 0)
      ELSE BOOL_AND(COALESCE(payout_run_status = 'failed', FALSE) AND COALESCE(is_retryable, FALSE))
      END AS selectable
    FROM queue_rows
    GROUP BY queue_group_id
  ), counts AS (
    SELECT jsonb_build_object(
      'ready', COUNT(*) FILTER (WHERE bucket = 'ready'),
      'processing', COUNT(*) FILTER (WHERE bucket = 'processing'),
      'action-required', COUNT(*) FILTER (WHERE bucket = 'action-required'),
      'history', COUNT(*) FILTER (WHERE bucket = 'history')
    ) AS value FROM groups
  ), matching_groups AS (
    SELECT * FROM groups WHERE bucket = p_bucket
  ), bounds AS (
    SELECT COUNT(*) AS total_groups,
      GREATEST((COUNT(*) + 19) / 20, 1) AS total_pages,
      LEAST(p_page::BIGINT, GREATEST((COUNT(*) + 19) / 20 - 1, 0)) AS page
    FROM matching_groups
  ), ranked_groups AS (
    SELECT g.*, ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN p_bucket = 'history' THEN paid_at END DESC NULLS LAST,
        CASE WHEN p_bucket = 'history' THEN queue_group_id END DESC,
        CASE WHEN p_bucket <> 'history' THEN lower(seller_name) END COLLATE "C" ASC NULLS LAST,
        queue_group_id ASC
    ) AS position
    FROM matching_groups g
  ), chosen_groups AS (
    SELECT g.* FROM ranked_groups g CROSS JOIN bounds b
    WHERE (p_scope = 'selection' AND g.selectable)
      OR (p_scope = 'page' AND g.position > b.page * 20
        AND g.position <= (b.page + 1) * 20)
  ), chosen_rows AS (
    SELECT COALESCE(
      jsonb_agg(r.row_data ORDER BY g.position, r.completed_at, r.shipment_id),
      '[]'::JSONB
    ) AS value
    FROM queue_rows r
    JOIN chosen_groups g ON g.queue_group_id = r.queue_group_id
  )
  SELECT jsonb_build_object(
    'rows', r.value,
    'counts', c.value,
    'bucket', p_bucket,
    'scope', p_scope,
    'page', CASE WHEN p_scope = 'page' THEN b.page ELSE 0 END,
    'pageSize', 20,
    'totalGroups', b.total_groups,
    'totalPages', b.total_pages,
    'selectedGroupCount', CASE WHEN p_scope = 'selection'
      THEN (SELECT COUNT(*) FROM chosen_groups) ELSE 0 END,
    'selectionComplete', p_scope = 'selection'
  ) INTO v_result
  FROM bounds b CROSS JOIN counts c CROSS JOIN chosen_rows r;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_admin_payout_queue(TEXT, TEXT, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_admin_payout_queue(TEXT, TEXT, INTEGER, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.fn_get_admin_payout_queue(TEXT, TEXT, INTEGER, TEXT) IS
  'Admin service-only read: complete seller/run group pages or all selectable matching groups. Selection does not authorize money movement.';

COMMIT;
