
DECLARE
    v_seller_id UUID;
    v_buyer_id UUID;
    v_shipment_id UUID;
    v_auth_user_id UUID;
    v_status public.dispute_status;
    v_order_id UUID;
    v_occurrence_id TEXT;
BEGIN
    v_auth_user_id := NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::UUID;
    IF v_auth_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
    END IF;

    SELECT d.seller_id, d.buyer_id, d.shipment_id, d.status, d.order_id
    INTO v_seller_id, v_buyer_id, v_shipment_id, v_status, v_order_id
    FROM public.disputes d WHERE d.id = p_dispute_id FOR UPDATE;

    IF NOT FOUND THEN RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN; END IF;
    IF v_seller_id IS DISTINCT FROM v_auth_user_id THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
    END IF;
    IF v_status IS DISTINCT FROM 'return_delivered' THEN
        RETURN QUERY SELECT false, 'INVALID_STATUS_FOR_EVIDENCE'::TEXT; RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(p_images) AS evidence_url(url) WHERE NULLIF(btrim(evidence_url.url), '') IS NOT NULL)
       OR NULLIF(btrim(p_video_url), '') IS NULL THEN
        RETURN QUERY SELECT false, 'EVIDENCE_REQUIRED'::TEXT; RETURN;
    END IF;
    IF v_buyer_id IS NULL OR v_order_id IS NULL OR v_shipment_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.orders o
        JOIN public.shipments s ON s.order_id = o.id
        WHERE o.id = v_order_id AND s.id = v_shipment_id
          AND o.buyer_id = v_buyer_id AND s.seller_id = v_seller_id
    ) THEN
        RETURN QUERY SELECT false, 'INVALID_DISPUTE_RELATIONSHIP'::TEXT; RETURN;
    END IF;

    UPDATE public.disputes
    SET seller_evidence = jsonb_build_object(
            'images', p_images,
            'video_url', p_video_url,
            'submitted_at', now(),
            'notification_event_id', gen_random_uuid()
        ),
        status = 'open',
        admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor ha impugnado el retorno y subido evidencia de video.',
        updated_at = now()
    WHERE id = p_dispute_id
    RETURNING seller_evidence->>'notification_event_id' INTO v_occurrence_id;

    IF v_occurrence_id IS NULL THEN
        RAISE EXCEPTION 'Missing seller evidence occurrence';
    END IF;

    IF v_buyer_id IS DISTINCT FROM v_auth_user_id THEN
        INSERT INTO public.notifications (
            user_id, type, title, message, action_path,
            event_kind, source_event_key, event_payload
        ) VALUES (
            v_buyer_id, 'info', 'Evidencia del retorno recibida',
            'El vendedor presentó evidencia del retorno. Consulta el estado de tu caso.',
            '/profile/orders/' || v_order_id::text,
            'return.seller_evidence_submitted',
            'return.seller_evidence_submitted:' || p_dispute_id::text || ':' || v_occurrence_id,
            jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id,
                               'recipient_role', 'buyer')
        )
        ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
    END IF;

    RETURN QUERY SELECT true, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_seller_submit_return_evidence',
            jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
    RETURN QUERY SELECT false, 'EVIDENCE_SUBMISSION_FAILED'::TEXT;
END;
