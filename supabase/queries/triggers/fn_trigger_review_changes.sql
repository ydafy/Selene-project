
BEGIN
    -- Llamamos al trabajador que actualizamos
    PERFORM public.fn_refresh_seller_stats(COALESCE(NEW.seller_id, OLD.seller_id));

    RETURN NULL; -- Correcto para triggers AFTER

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en trigger tr_after_review_change',
            jsonb_build_object(
                'operation', TG_OP,
                'seller_id', COALESCE(NEW.seller_id, OLD.seller_id),
                'error', SQLERRM
            ));
    RAISE; -- Forzamos rollback para evitar inconsistencia
END;
