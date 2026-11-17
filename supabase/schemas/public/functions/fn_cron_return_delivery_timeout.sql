CREATE OR REPLACE FUNCTION public.fn_cron_return_delivery_timeout()
  RETURNS TABLE (
    total_processed integer,
    total_errors    integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_dispute    RECORD;
  v_processed  INT := 0;
  v_errors     INT := 0;
  v_success    BOOLEAN;
  v_err_msg    TEXT;
  v_is_connect BOOLEAN;
BEGIN
  FOR v_dispute IN
    SELECT d.id, d.shipment_id, d.buyer_id, d.seller_id, d.order_id
    FROM public.disputes d
    WHERE d.status = 'return_delivered'
      AND d.return_delivered_at < now() - interval '48 hours'
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      -- Connect guard: if the shipment was paid via Stripe Connect,
      -- skip fn_complete_shipment_refund. Connect refunds
      -- are handled by resolve-dispute-refund with reverse_transfer.
      SELECT EXISTS(
        SELECT 1 FROM public.shipments
        WHERE id = v_dispute.shipment_id
          AND stripe_payment_intent_id IS NOT NULL
      ) INTO v_is_connect;

      IF v_is_connect THEN
        -- Connect path: just mark dispute resolved.
        -- The actual refund should be triggered by resolve-dispute-refund.
        UPDATE public.disputes
        SET status = 'resolved',
            resolution_type = 'buyer_wins_timeout',
            admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Retorno entregado + 48h timeout. Refund pendiente de ejecución manual (Connect).',
            updated_at = now()
        WHERE id = v_dispute.id;

        INSERT INTO public.notifications (user_id, type, title, message, action_path)
        VALUES
          (v_dispute.buyer_id, 'success', 'Devolución Recibida', 'El vendedor recibió el producto. Tu reembolso está pendiente de procesamiento.', '/profile/orders/' || v_dispute.order_id || COALESCE('?shipment_id=' || v_dispute.shipment_id::text, ''));

        v_processed := v_processed + 1;
      ELSE
        -- No Stripe payment intent: needs manual intervention.
        INSERT INTO internal.ops_failures (source, code, context)
        VALUES ('fn_cron_return_delivery_timeout', 'SHIPMENT_NOT_CONNECT',
                jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id));
        v_errors := v_errors + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO internal.ops_failures (source, code, context)
      VALUES ('fn_cron_return_delivery_timeout', SQLSTATE,
              jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', SQLERRM));
      v_errors := v_errors + 1;
    END;
  END LOOP;

  -- cron.job_run_details records the run; the counts are returned, not logged.
  RETURN QUERY SELECT v_processed, v_errors;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_cron_return_delivery_timeout"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_cron_return_delivery_timeout"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_cron_return_delivery_timeout"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_cron_return_delivery_timeout"() FROM PUBLIC, "anon", "authenticated";
