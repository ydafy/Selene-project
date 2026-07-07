
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
      -- skip fn_complete_shipment_refund (wallet ops). Connect refunds
      -- are handled by resolve-dispute-refund with reverse_transfer.
      SELECT EXISTS(
        SELECT 1 FROM public.shipments
        WHERE id = v_dispute.shipment_id
          AND stripe_payment_intent_id IS NOT NULL
      ) INTO v_is_connect;

      IF v_is_connect THEN
        -- Connect path: just mark dispute resolved, no wallet ops needed.
        -- The actual refund should be triggered by resolve-dispute-refund.
        UPDATE public.disputes
        SET status = 'resolved',
            resolution_type = 'buyer_wins_timeout',
            admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Retorno entregado + 48h timeout. Refund pendiente de ejecución manual (Connect).',
            updated_at = now()
        WHERE id = v_dispute.id;

        INSERT INTO public.notifications (user_id, type, title, message, action_path)
        VALUES
          (v_dispute.buyer_id, 'success', 'Devolución Recibida', 'El vendedor recibió el producto. Tu reembolso está pendiente de procesamiento.', '/profile/orders/' || v_dispute.order_id);

        v_processed := v_processed + 1;
      ELSE
        -- Legacy path: wallet rollback via fn_complete_shipment_refund
        SELECT * INTO v_success, v_err_msg
        FROM public.fn_complete_shipment_refund(v_dispute.shipment_id);

        IF v_success THEN
          v_processed := v_processed + 1;
        ELSE
          INSERT INTO public.system_logs (level, message, metadata)
          VALUES ('WARNING', 'Cron return-delivery-timeout: fallo en dispute',
                  jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', v_err_msg));
          v_errors := v_errors + 1;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.system_logs (level, message, metadata)
      VALUES ('ERROR', 'Cron return-delivery-timeout: excepción física',
              jsonb_build_object('dispute_id', v_dispute.id, 'error', SQLERRM));
      v_errors := v_errors + 1;
    END;
  END LOOP;

  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('INFO', 'Cron return-delivery-timeout completado',
          jsonb_build_object('processed', v_processed, 'errors', v_errors));

  RETURN QUERY SELECT v_processed, v_errors;
END;
