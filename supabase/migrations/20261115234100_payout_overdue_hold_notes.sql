SET local check_function_bodies = off;

DROP VIEW "public"."admin_connect_payout_release_view";

CREATE TABLE "public"."shipment_payout_hold_notes" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "shipment_id" uuid                     NOT NULL,
  "admin_id"    uuid                     NOT NULL,
  "note"        text                     NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "shipment_payout_hold_notes_note_check" CHECK (((note = btrim(note, E' \t\n\r'::text)) AND ((char_length(note) >= 1) AND (char_length(note) <= 1000)))),
  CONSTRAINT "shipment_payout_hold_notes_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."shipment_payout_hold_notes"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."shipment_payout_hold_notes" FROM "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_admin_record_payout_hold_note (
  p_admin_id    uuid,
  p_shipment_id uuid,
  p_note        text
)
  RETURNS public.shipment_payout_hold_notes
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  v_note TEXT := btrim(p_note, E' \t\n\r');
  v_held RECORD;
  v_row public.shipment_payout_hold_notes%ROWTYPE;
BEGIN
  -- Defense in depth: the admin id is written to the note and the audit log, so
  -- it must be an active admin by the same rule as is_admin(), not only what
  -- the caller checked.
  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles_private
    WHERE id = p_admin_id AND role = 'admin' AND COALESCE(status::text, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  IF v_note IS NULL OR char_length(v_note) < 1 OR char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'INVALID_HOLD_NOTE';
  END IF;

  -- Shipment first, the lock order of the cancellation and transfer paths.
  PERFORM 1 FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;

  SELECT v.is_payout_overdue, v.seller_payout_block_reason, v.days_since_completed
    INTO v_held
    FROM public.admin_connect_payout_release_view v
    WHERE v.shipment_id = p_shipment_id;
  IF v_held.is_payout_overdue IS NOT TRUE THEN
    RAISE EXCEPTION 'PAYOUT_NOT_OVERDUE';
  END IF;

  INSERT INTO public.shipment_payout_hold_notes (shipment_id, admin_id, note, created_at)
  VALUES (p_shipment_id, p_admin_id, v_note, clock_timestamp())
  RETURNING * INTO v_row;

  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (p_admin_id, 'PAYOUT_HOLD_NOTED', p_shipment_id,
    jsonb_build_object(
      'note_id', v_row.id,
      'note', v_row.note,
      'seller_payout_block_reason', v_held.seller_payout_block_reason,
      'days_since_completed', v_held.days_since_completed));

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."fn_admin_record_payout_hold_note"(uuid, uuid, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_get_admin_payout_queue (
  p_search text    DEFAULT ''::text,
  p_bucket text    DEFAULT 'ready'::text,
  p_page   integer DEFAULT 0,
  p_scope  text    DEFAULT 'page'::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
DECLARE
  v_search TEXT := btrim(COALESCE(p_search, ''));
  v_result JSONB;
BEGIN
  IF p_bucket IS NULL OR p_bucket NOT IN ('ready', 'overdue', 'processing', 'action-required', 'history') THEN
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
      -- An overdue held payout (#549) leaves its seller's ready group for an
      -- overdue group of its own, and returns once the account is payable.
      -- A shipment in a run stays with its run.
      CASE WHEN q.payout_run_id IS NULL AND q.is_payout_overdue
        THEN 'overdue:' || q.seller_id::TEXT
        WHEN q.payout_run_id IS NULL
        THEN 'seller:' || q.seller_id::TEXT
        ELSE 'run:' || q.payout_run_id::TEXT END AS queue_group_id,
      CASE WHEN q.payout_run_id IS NULL AND q.is_payout_overdue THEN 4
        WHEN q.payout_run_id IS NULL THEN 0
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
        WHEN 2 THEN 'processing' WHEN 4 THEN 'overdue' ELSE 'action-required' END AS bucket,
      MIN(seller_name) AS seller_name,
      MAX(payout_run_paid_at) AS paid_at,
      CASE WHEN MAX(bucket_rank) = 0 THEN
        BOOL_OR(is_eligible IS TRUE AND release_amount_cents > 0)
      WHEN MAX(bucket_rank) = 4 THEN FALSE
      ELSE BOOL_AND(COALESCE(payout_run_status = 'failed', FALSE) AND COALESCE(is_retryable, FALSE))
      END AS selectable
    FROM queue_rows
    GROUP BY queue_group_id
  ), counts AS (
    SELECT jsonb_build_object(
      'ready', COUNT(*) FILTER (WHERE bucket = 'ready'),
      'overdue', COUNT(*) FILTER (WHERE bucket = 'overdue'),
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
$function$;

ALTER TABLE "public"."shipment_payout_hold_notes"
  ADD CONSTRAINT "shipment_payout_hold_notes_admin_id_fkey" FOREIGN KEY (admin_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."shipment_payout_hold_notes"
  ADD CONSTRAINT "shipment_payout_hold_notes_shipment_id_fkey" FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE RESTRICT;

CREATE VIEW "public"."admin_connect_payout_release_view" WITH (security_invoker=true) AS  WITH shipment_amounts AS (
         SELECT s.id AS shipment_id,
            s.seller_id,
            s.order_id,
            s.status,
            s.completed_at,
            s.stripe_payment_intent_id,
            s.stripe_payout_id,
            s.shipping_cost_cents,
            pp.stripe_account_id,
            pp.stripe_onboarding_status,
            p.username AS seller_name,
            (s.status = 'completed'::public.order_status) AS is_completed,
            (s.completed_at IS NOT NULL) AS has_completed_at,
            (s.stripe_payment_intent_id IS NOT NULL) AS has_connect_payment_intent,
            GREATEST(
                CASE
                    WHEN (o.stripe_transfer_group IS NOT NULL) THEN (COALESCE(sum(oi.net_payout_cents), (0)::numeric))::integer
                    ELSE ((COALESCE(sum(oi.net_payout_cents), (0)::numeric))::integer - (COALESCE(s.shipping_cost_cents, (0)::bigint))::integer)
                END, 0) AS release_amount_cents,
            ((s.shipping_cost_cents IS NOT NULL) AND (s.shipping_cost_cents > 0)) AS has_shipping_cost_cents,
            (EXISTS ( SELECT 1
                   FROM public.disputes d
                  WHERE ((d.shipment_id = s.id) AND (d.status = ANY (ARRAY['open'::public.dispute_status, 'under_review'::public.dispute_status, 'waiting_return'::public.dispute_status, 'return_shipped'::public.dispute_status, 'return_delivered'::public.dispute_status]))))) AS has_active_dispute,
            (EXISTS ( SELECT 1
                   FROM public.connect_payout_run_shipments crs
                  WHERE ((crs.shipment_id = s.id) AND (crs.status = ANY (ARRAY['pending_reconciliation'::text, 'paid'::text, 'reconciliation_needed'::text]))))) AS has_active_release,
            o.stripe_transfer_group AS transfer_group,
            s.stripe_transfer_id,
            (EXISTS ( SELECT 1
                   FROM public.connect_payout_run_shipments started
                  WHERE ((started.shipment_id = s.id) AND (started.transfer_started_at IS NOT NULL)))) AS has_transfer_started
           FROM ((((public.shipments s
             JOIN public.orders o ON ((o.id = s.order_id)))
             LEFT JOIN public.order_items oi ON ((oi.shipment_id = s.id)))
             LEFT JOIN public.profiles_private pp ON ((pp.id = s.seller_id)))
             LEFT JOIN public.profiles p ON ((p.id = s.seller_id)))
          GROUP BY s.id, s.seller_id, s.order_id, s.status, s.completed_at, s.stripe_payment_intent_id, s.stripe_payout_id, s.shipping_cost_cents, pp.stripe_account_id, pp.stripe_onboarding_status, p.username, o.stripe_transfer_group, s.stripe_transfer_id
        )
 SELECT sa.shipment_id,
    sa.seller_id,
    sa.seller_name,
    sa.order_id,
    sa.status,
    sa.completed_at,
    sa.stripe_payment_intent_id,
    sa.stripe_account_id,
    sa.stripe_onboarding_status,
    sa.release_amount_cents,
    (sa.is_completed AND sa.has_completed_at AND sa.has_connect_payment_intent AND (NOT sa.has_active_dispute) AND (NOT sa.has_active_release) AND (payout_run.id IS NULL) AND ((sa.transfer_group IS NOT NULL) OR sa.has_shipping_cost_cents) AND (sa.stripe_account_id IS NOT NULL) AND (sa.stripe_onboarding_status = 'complete'::public.stripe_onboarding_status) AND (sa.release_amount_cents > 0)) AS is_eligible,
        CASE
            WHEN (NOT sa.is_completed) THEN 'shipment_not_completed'::text
            WHEN (NOT sa.has_completed_at) THEN 'missing_completed_at'::text
            WHEN (NOT sa.has_connect_payment_intent) THEN 'missing_connect_payment_intent'::text
            WHEN sa.has_active_dispute THEN 'active_dispute'::text
            WHEN sa.has_active_release THEN 'already_released'::text
            WHEN (payout_run.status = 'canceled'::text) THEN 'payout_canceled_manual_review'::text
            WHEN (payout_run.status = 'failed'::text) THEN 'payout_failed_retry_required'::text
            WHEN (payout_run.id IS NOT NULL) THEN 'payout_run_history_requires_review'::text
            WHEN ((sa.transfer_group IS NULL) AND (NOT sa.has_shipping_cost_cents)) THEN 'missing_shipping_cost'::text
            WHEN (sa.stripe_account_id IS NULL) THEN 'missing_stripe_account'::text
            WHEN ((sa.stripe_onboarding_status <> 'complete'::public.stripe_onboarding_status) OR (sa.stripe_onboarding_status IS NULL)) THEN 'seller_not_payout_ready'::text
            WHEN (sa.release_amount_cents <= 0) THEN 'missing_release_amount'::text
            ELSE NULL::text
        END AS ineligible_reason,
    sa.transfer_group,
    sa.stripe_transfer_id,
    payout_run.id AS payout_run_id,
    payout_run.status AS payout_run_status,
    (payout_run.amount_cents)::integer AS payout_run_amount_cents,
    payout_run.failure_reason AS payout_run_failure_reason,
    payout_run.failed_at AS payout_run_failed_at,
    payout_run.retry_of_run_id,
    COALESCE(((payout_run.status = 'failed'::text) AND (NOT payout_run.has_protected_release) AND (NOT payout_run.has_retry_child)), false) AS is_retryable,
    COALESCE((payout_run.status = 'canceled'::text), false) AS requires_manual_review,
    payout_run.paid_at AS payout_run_paid_at,
    held.seller_payout_block_reason,
    held.days_since_completed,
    (sa.is_completed AND sa.has_completed_at AND (sa.stripe_transfer_id IS NULL) AND (sa.stripe_payout_id IS NULL) AND (NOT sa.has_transfer_started) AND (payout_run.status IS DISTINCT FROM 'paid'::text) AND (held.seller_payout_block_reason IS NOT NULL) AND (held.days_since_completed >= 30)) AS is_payout_overdue,
    latest_hold_note.note AS latest_hold_note,
    latest_hold_note.created_at AS latest_hold_noted_at,
    latest_hold_note.admin_id AS latest_hold_noted_by
   FROM ((((shipment_amounts sa
     LEFT JOIN LATERAL ( SELECT pr.id,
            pr.status,
            pr.amount_cents,
            pr.failure_reason,
            pr.failed_at,
            pr.paid_at,
            pr.retry_of_run_id,
            (EXISTS ( SELECT 1
                   FROM public.connect_payout_runs retry_child
                  WHERE (retry_child.retry_of_run_id = pr.id))) AS has_retry_child,
            (EXISTS ( SELECT 1
                   FROM (public.connect_payout_run_shipments source_mapping
                     JOIN public.connect_payout_run_shipments protected_mapping ON ((protected_mapping.shipment_id = source_mapping.shipment_id)))
                  WHERE ((source_mapping.run_id = pr.id) AND (protected_mapping.status = ANY (ARRAY['pending_reconciliation'::text, 'paid'::text, 'reconciliation_needed'::text]))))) AS has_protected_release
           FROM (public.connect_payout_run_shipments crs
             JOIN public.connect_payout_runs pr ON ((pr.id = crs.run_id)))
          WHERE (crs.shipment_id = sa.shipment_id)
          ORDER BY pr.created_at DESC, pr.id DESC
         LIMIT 1) payout_run ON (true))
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN (sa.is_completed AND (sa.stripe_transfer_id IS NULL) AND (sa.stripe_onboarding_status = 'complete'::public.stripe_onboarding_status) AND (sa.stripe_account_id IS NOT NULL) AND (btrim(sa.stripe_account_id) <> ''::text)) THEN ( SELECT
                            CASE
                                WHEN gate.is_actionable THEN NULL::text
                                ELSE COALESCE(gate.blocked_reason, 'account_not_actionable'::text)
                            END AS "case"
                       FROM public.fn_get_connect_account_actionability(sa.stripe_account_id) gate(is_actionable, blocked_reason))
                    ELSE NULL::text
                END AS blocked_reason) account_gate ON (true))
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN ((NOT sa.is_completed) OR (sa.stripe_transfer_id IS NOT NULL) OR (sa.stripe_account_id IS NULL) OR (payout_run.status = 'paid'::text)) THEN NULL::text
                    WHEN (sa.stripe_onboarding_status = 'rejected'::public.stripe_onboarding_status) THEN 'onboarding_rejected'::text
                    WHEN ((sa.stripe_onboarding_status <> 'complete'::public.stripe_onboarding_status) OR (sa.stripe_onboarding_status IS NULL)) THEN 'onboarding_pending'::text
                    ELSE account_gate.blocked_reason
                END AS seller_payout_block_reason,
                CASE
                    WHEN (sa.completed_at IS NULL) THEN NULL::integer
                    ELSE (EXTRACT(day FROM (now() - sa.completed_at)))::integer
                END AS days_since_completed) held ON (true))
     LEFT JOIN LATERAL ( SELECT n.note,
            n.created_at,
            n.admin_id
           FROM public.shipment_payout_hold_notes n
          WHERE (n.shipment_id = sa.shipment_id)
          ORDER BY n.created_at DESC, n.id DESC
         LIMIT 1) latest_hold_note ON (true));

REVOKE ALL ON TABLE "public"."admin_connect_payout_release_view" FROM "anon", "authenticated";

CREATE INDEX ix_shipment_payout_hold_notes_admin_id ON public.shipment_payout_hold_notes USING btree (admin_id);

CREATE INDEX ix_shipment_payout_hold_notes_shipment_created ON public.shipment_payout_hold_notes USING btree (shipment_id, created_at DESC);

COMMENT ON FUNCTION "public"."fn_admin_record_payout_hold_note"(uuid, uuid, text) IS 'Service-only (SECURITY INVOKER; EXECUTE revoked from PUBLIC, anon and authenticated because the admin id is trusted only from an Edge Function that verified the admin session): an active admin keeps an overdue held payout on hold with a note (#549). Locks the shipment, refuses a shipment that is not overdue in admin_connect_payout_release_view, and writes the note and a PAYOUT_HOLD_NOTED audit row.';

COMMENT ON TABLE "public"."shipment_payout_hold_notes" IS 'Append-only notes an admin writes when keeping an overdue held payout on hold (#549). Written only by fn_admin_record_payout_hold_note, which also writes the admin_audit_logs row; clients have no grants and no policy.';

REVOKE ALL ON FUNCTION "public"."fn_admin_record_payout_hold_note"(uuid, uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_admin_record_payout_hold_note"(uuid, uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_admin_record_payout_hold_note"(uuid, uuid, text) TO "service_role";

REVOKE ALL ON TABLE "public"."shipment_payout_hold_notes" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shipment_payout_hold_notes" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shipment_payout_hold_notes" TO "service_role";

REVOKE ALL ON TABLE "public"."admin_connect_payout_release_view" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_connect_payout_release_view" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_connect_payout_release_view" TO "service_role";
