
DECLARE
    v_avg_rating NUMERIC;
    v_rev_count INTEGER;
    v_sales_count INTEGER;
BEGIN
    -- 1. Cálculo de reseñas en un solo escaneo
    SELECT
        COALESCE(ROUND(AVG(rating)::numeric, 1), 0.0),
        COUNT(*)
    INTO v_avg_rating, v_rev_count
    FROM public.reviews
    WHERE seller_id = p_seller_id;

    -- 2. Cálculo de ventas completadas
    SELECT COUNT(DISTINCT o.id)
    INTO v_sales_count
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE oi.seller_id = p_seller_id
    AND o.status = 'completed';

    -- 3. Actualización atómica en el perfil
    UPDATE public.profiles
    SET
        average_rating = v_avg_rating,
        total_reviews = v_rev_count,
        total_sales = v_sales_count
    WHERE id = p_seller_id;

EXCEPTION WHEN OTHERS THEN
    -- Registro en la Caja Negra (Metadata JSONB)
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en recálculo de reputación',
            jsonb_build_object('seller_id', p_seller_id, 'error', SQLERRM));
END;
