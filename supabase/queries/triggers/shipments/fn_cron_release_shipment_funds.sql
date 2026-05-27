
DECLARE
  v_shipment_id   UUID;
  v_processed     INT := 0;
  v_errors        INT := 0;
  v_success       BOOLEAN;
  v_error_message TEXT;
BEGIN
  FOR v_shipment_id IN
    SELECT s.id
    FROM public.shipments s
    WHERE s.status = 'delivered'
      AND s.delivered_at < now() - interval '48 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.disputes d
        WHERE d.shipment_id = s.id
          AND d.status NOT IN ('resolved', 'rejected')
      )
  LOOP
    BEGIN
      SELECT * INTO v_success, v_error_message
      FROM public.fn_release_shipment_funds(v_shipment_id);

      IF v_success THEN
        v_processed := v_processed + 1;
      ELSE
        INSERT INTO public.system_logs (level, message, metadata)
        VALUES ('WARNING', 'Cron release-shipment-funds: fallo lógico en shipment',
                jsonb_build_object('shipment_id', v_shipment_id, 'error', v_error_message));
        v_errors := v_errors + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.system_logs (level, message, metadata)
      VALUES ('ERROR', 'Cron release-shipment-funds: excepción física en shipment',
              jsonb_build_object('shipment_id', v_shipment_id, 'error', SQLERRM));
      v_errors := v_errors + 1;
    END;
  END LOOP;

  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('INFO', 'Cron release-shipment-funds completado',
          jsonb_build_object('processed', v_processed, 'errors', v_errors));

  RETURN QUERY SELECT v_processed, v_errors;
END;
