CREATE VIEW "public"."admin_connect_payout_release_view" WITH (security_invoker=true) AS  WITH shipment_amounts AS (
         SELECT s.id AS shipment_id,
            s.seller_id,
            s.order_id,
            s.status,
            s.completed_at,
            s.stripe_payment_intent_id,
            s.stripe_payout_id,
            s.shipping_cost,
            pp.stripe_account_id,
            pp.stripe_onboarding_status,
            p.username AS seller_name,
            (s.status = 'completed'::public.order_status_enum) AS is_completed,
            (s.completed_at IS NOT NULL) AS has_completed_at,
            (s.stripe_payment_intent_id IS NOT NULL) AS has_connect_payment_intent,
            GREATEST(
                CASE
                    WHEN (o.stripe_transfer_group IS NOT NULL) THEN (round((COALESCE(sum(oi.net_payout), (0)::numeric) * (100)::numeric)))::integer
                    ELSE ((round((COALESCE(sum(oi.net_payout), (0)::numeric) * (100)::numeric)))::integer - COALESCE(s.shipping_cost, 0))
                END, 0) AS release_amount_cents,
            ((s.shipping_cost IS NOT NULL) AND (s.shipping_cost > 0)) AS has_shipping_cost_cents,
            (EXISTS ( SELECT 1
                   FROM public.disputes d
                  WHERE ((d.shipment_id = s.id) AND (d.status = ANY (ARRAY['open'::public.dispute_status, 'under_review'::public.dispute_status, 'waiting_return'::public.dispute_status, 'return_shipped'::public.dispute_status, 'return_delivered'::public.dispute_status]))))) AS has_active_dispute,
            (EXISTS ( SELECT 1
                   FROM public.connect_payout_run_shipments crs
                  WHERE ((crs.shipment_id = s.id) AND (crs.status = ANY (ARRAY['pending_reconciliation'::text, 'paid'::text, 'reconciliation_needed'::text]))))) AS has_active_release,
            o.stripe_transfer_group AS transfer_group,
            s.stripe_transfer_id
           FROM ((((public.shipments s
             JOIN public.orders o ON ((o.id = s.order_id)))
             LEFT JOIN public.order_items oi ON ((oi.shipment_id = s.id)))
             LEFT JOIN public.profiles_private pp ON ((pp.id = s.seller_id)))
             LEFT JOIN public.profiles p ON ((p.id = s.seller_id)))
          GROUP BY s.id, s.seller_id, s.order_id, s.status, s.completed_at, s.stripe_payment_intent_id, s.stripe_payout_id, s.shipping_cost, pp.stripe_account_id, pp.stripe_onboarding_status, p.username, o.stripe_transfer_group, s.stripe_transfer_id
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
    payout_run.amount AS payout_run_amount_cents,
    payout_run.failure_reason AS payout_run_failure_reason,
    payout_run.failed_at AS payout_run_failed_at,
    payout_run.retry_of_run_id,
    COALESCE(((payout_run.status = 'failed'::text) AND (NOT payout_run.has_protected_release) AND (NOT payout_run.has_retry_child)), false) AS is_retryable,
    COALESCE((payout_run.status = 'canceled'::text), false) AS requires_manual_review,
    payout_run.paid_at AS payout_run_paid_at,
        CASE
            WHEN ((NOT sa.is_completed) OR (sa.stripe_transfer_id IS NOT NULL) OR (sa.stripe_account_id IS NULL) OR (payout_run.status = 'paid'::text)) THEN NULL::text
            WHEN (sa.stripe_onboarding_status = 'rejected'::public.stripe_onboarding_status) THEN 'onboarding_rejected'::text
            WHEN ((sa.stripe_onboarding_status <> 'complete'::public.stripe_onboarding_status) OR (sa.stripe_onboarding_status IS NULL)) THEN 'onboarding_pending'::text
            ELSE account_gate.blocked_reason
        END AS seller_payout_block_reason,
        CASE
            WHEN (sa.completed_at IS NULL) THEN NULL::integer
            ELSE (EXTRACT(day FROM (now() - sa.completed_at)))::integer
        END AS days_since_completed
   FROM ((shipment_amounts sa
     LEFT JOIN LATERAL ( SELECT pr.id,
            pr.status,
            pr.amount,
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
                END AS blocked_reason) account_gate ON (true));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_connect_payout_release_view" TO "service_role";

REVOKE ALL ON TABLE "public"."admin_connect_payout_release_view" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_connect_payout_release_view" TO "postgres";

REVOKE ALL ON TABLE "public"."admin_connect_payout_release_view" FROM "anon", "authenticated";
