-- shipment.payout_blocked producer (#549, odd/tasks/held-payout-seller-notice.md
-- T2, S2-S4). The pg_cron job held-payout-seller-notices runs it hourly.
--
-- Reads admin_connect_payout_release_view, the release queue's own source, and
-- notifies the seller of a completed, untransferred shipment that is not in a
-- paid run or an active dispute and that their account keeps from being paid.
-- Only reasons the seller can fix are notified; payouts_schedule_not_manual
-- (Selene's setting), account_refresh_pending, destination_undetermined,
-- account_not_actionable and a NULL reason show only in the admin queue.
-- Notifying changes no money rule: eligibility stays the view's.
--
-- Stages: one notice per shipment for the greatest of 0, 3, 7 and 14 days that
-- completed_at is old, keyed 'shipment.payout_blocked:<shipment_id>:<stage>',
-- so the unique (source_event_key, user_id) index sends each stage once and a
-- shipment first found blocked on day 10 gets stage 7 only. Nothing follows
-- stage 14, and nothing is sent once the account is unblocked. Running it
-- twice sends nothing new. Each notice is its own subtransaction: a failure is
-- logged to system_logs as a WARNING and the run goes on. Returns the number
-- of notices inserted.
--
-- Grant review (AGENTS.md): SECURITY DEFINER with search_path '' because it
-- writes notices for other users and reads the view's private sources the same
-- way whoever calls it. Only pg_cron calls it, as postgres, so EXECUTE is
-- revoked from PUBLIC, anon, authenticated and service_role and kept for
-- postgres alone; no client and no Edge Function calls it.
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

REVOKE ALL ON FUNCTION "internal"."fn_notify_held_payouts"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "internal"."fn_notify_held_payouts"() TO "postgres";

REVOKE ALL ON FUNCTION "internal"."fn_notify_held_payouts"() FROM PUBLIC, "anon", "authenticated", "service_role";
