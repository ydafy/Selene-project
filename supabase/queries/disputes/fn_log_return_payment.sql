
DECLARE
    v_locked_id UUID;
BEGIN
    -- 1. Validar disputa con bloqueo pesimista
    SELECT id
      INTO v_locked_id
    FROM public.disputes
    WHERE id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'DISPUTE_NOT_FOUND: %', p_dispute_id USING ERRCODE = 'P0002';
    END IF;

    -- 2. Actualizar disputa: pago procesado + transición a return_shipped
    UPDATE public.disputes
    SET return_payout_id = p_stripe_id,
        return_payout_status = 'paid',
        status = 'return_shipped',
        updated_at = now()
    WHERE id = p_dispute_id;
END;
