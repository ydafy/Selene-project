-- shipment.payout_blocked: tell the seller when their account keeps a completed
-- sale from being paid, and remind them at 3, 7 and 14 days (#549,
-- odd/tasks/held-payout-seller-notice.md T2, S2-S4). No money rule changes:
-- eligibility stays admin_connect_payout_release_view's.
--
-- Catalogue: keeps every existing kind and adds shipment.payout_blocked.
-- internal.fn_notify_held_payouts reads the release view and inserts one notice
-- per shipment and due stage; the held-payout-seller-notices job runs it hourly
-- as postgres. The push policy row is in
-- 20261114013143_held_payout_seller_notice_push_policy.sql.
--
-- Grant review (AGENTS.md): SECURITY DEFINER with search_path '' because it
-- writes notices for other users. EXECUTE is revoked from PUBLIC; anon,
-- authenticated and service_role never had it (internal has no default
-- privileges), so only postgres, the pg_cron caller, can run it.
-- Canonical definition: supabase/schemas/internal/functions/fn_notify_held_payouts.sql
SET local check_function_bodies = off;

ALTER TABLE "public"."notifications"
  DROP CONSTRAINT "notifications_event_kind_catalogue_chk";

CREATE OR REPLACE FUNCTION internal.fn_notify_held_payouts()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_row record;
  v_key text;
  v_is_reminder boolean;
  v_inserted integer;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT v.shipment_id,
           v.seller_id,
           v.order_id,
           v.release_amount_cents,
           v.seller_payout_block_reason AS block_reason,
           CASE
             WHEN v.days_since_completed >= 14 THEN 14
             WHEN v.days_since_completed >= 7 THEN 7
             WHEN v.days_since_completed >= 3 THEN 3
             ELSE 0
           END AS stage
    FROM public.admin_connect_payout_release_view AS v
    WHERE v.status = 'completed'
      AND v.completed_at IS NOT NULL
      AND v.days_since_completed >= 0
      AND v.stripe_payment_intent_id IS NOT NULL
      AND v.stripe_transfer_id IS NULL
      AND v.release_amount_cents > 0
      AND v.ineligible_reason IS DISTINCT FROM 'active_dispute'
      AND v.payout_run_status IS DISTINCT FROM 'paid'
      AND v.seller_payout_block_reason IN (
        'onboarding_rejected',
        'onboarding_pending',
        'payouts_disabled',
        'errored',
        'verification_failed',
        'tokenized_account_number_deactivated'
      )
    ORDER BY v.completed_at, v.shipment_id
  LOOP
    BEGIN
      v_key := 'shipment.payout_blocked:' || v_row.shipment_id::text || ':' || v_row.stage::text;

      SELECT EXISTS (
        SELECT 1
        FROM public.notifications AS n
        WHERE n.user_id = v_row.seller_id
          AND n.source_event_key = ANY (ARRAY(
            SELECT 'shipment.payout_blocked:' || v_row.shipment_id::text || ':' || s.stage::text
            FROM unnest(ARRAY[0, 3, 7, 14]) AS s(stage)
            WHERE s.stage <> v_row.stage
          ))
      ) INTO v_is_reminder;

      INSERT INTO public.notifications (
        user_id, event_kind, source_event_key, event_payload, type, title, message, action_path
      ) VALUES (
        v_row.seller_id,
        'shipment.payout_blocked',
        v_key,
        jsonb_build_object(
          'order_id', v_row.order_id,
          'shipment_id', v_row.shipment_id,
          'amount_cents', v_row.release_amount_cents,
          'currency', 'mxn',
          'recipient_role', 'seller',
          'block_reason', v_row.block_reason,
          'reminder_stage', v_row.stage,
          'is_reminder', v_is_reminder
        ),
        'warning',
        CASE WHEN v_is_reminder THEN 'Tu pago sigue retenido' ELSE 'No podemos enviarte el pago de una venta' END,
        CASE v_row.block_reason
          WHEN 'onboarding_rejected' THEN 'Stripe rechazó tu cuenta de cobro.'
          WHEN 'onboarding_pending' THEN 'Stripe necesita más datos de tu cuenta de cobro.'
          WHEN 'payouts_disabled' THEN 'Stripe pausó los pagos a tu cuenta.'
          ELSE 'Tu cuenta bancaria tiene un problema.'
        END
          || ' Revisa tu configuración de pagos para recibir $'
          || to_char(v_row.release_amount_cents / 100.0, 'FM999,999,990.00') || ' MXN.',
        '/sell/onboarding'
      )
      ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_count := v_count + v_inserted;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.system_logs (level, message, metadata) VALUES ('WARNING', 'Held payout notice failed',
        jsonb_build_object('shipment_id', v_row.shipment_id, 'stage', v_row.stage, 'sqlstate', SQLSTATE, 'error', SQLERRM));
    END;
  END LOOP;

  RETURN v_count;
END;
$function$;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_event_kind_catalogue_chk"
    CHECK
    (((event_kind IS NULL) OR (event_kind = ANY (ARRAY['order.payment_confirmed'::text, 'shipment.cancelled'::text, 'shipment.refund_failed'::text, 'dispute.opened'::text,
    'dispute.verdict'::text,
    'product.approved'::text,
    'product.approved_with_note'::text,
    'product.rejected'::text,
    'return.seller_evidence_submitted'::text,
    'return.delivered'::text,
    'product.available'::text,
    'product.interest'::text,
    'shipment.in_transit'::text,
    'shipment.delivered'::text, 'shipment.funds_released'::text, 'shipment.refunded'::text, 'shipment.label_deadline'::text, 'shipment.payout_blocked'::text]))));

REVOKE ALL ON FUNCTION "internal"."fn_notify_held_payouts"() FROM PUBLIC;

SELECT cron.schedule_in_database('held-payout-seller-notices', '20 * * * *', 'select internal.fn_notify_held_payouts()', 'postgres', NULL, true);
