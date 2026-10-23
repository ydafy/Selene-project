-- fn_tr_product_available_on_verify
-- Introduced by 20261023004035_product_available_notification.sql.
--
-- Fires when a listing first reaches VERIFIED from the verification queue.
-- VERIFIED is also re-entered from RESERVED, HIDDEN and others by many paths;
-- those must not notify, so the WHEN clause limits the old status.

CREATE OR REPLACE FUNCTION public.fn_tr_product_available_on_verify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.fn_notify_product_available(ARRAY[NEW.id]);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_available_on_verify ON public.products;
CREATE TRIGGER trg_product_available_on_verify
  AFTER UPDATE OF status ON public.products
  FOR EACH ROW
  WHEN (OLD.status IN ('PENDING_VERIFICATION', 'IN_REVIEW') AND NEW.status = 'VERIFIED')
  EXECUTE FUNCTION public.fn_tr_product_available_on_verify();
