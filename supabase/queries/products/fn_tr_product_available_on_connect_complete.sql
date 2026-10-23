-- fn_tr_product_available_on_connect_complete
-- Introduced by 20261023004035_product_available_notification.sql.
--
-- Fires when a seller's Stripe Connect onboarding becomes 'complete'. Their
-- live VERIFIED listings turn purchasable, so buyers who favorited them are
-- told. Re-completing after a downgrade is harmless: the helper dedupes.

CREATE OR REPLACE FUNCTION public.fn_tr_product_available_on_connect_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.fn_notify_product_available(
    ARRAY(
      SELECT p.id
      FROM public.products p
      WHERE p.seller_id = NEW.id
        AND p.status = 'VERIFIED'
        AND p.deleted_at IS NULL
    )
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_available_on_connect_complete ON public.profiles_private;
CREATE TRIGGER trg_product_available_on_connect_complete
  AFTER UPDATE OF stripe_onboarding_status ON public.profiles_private
  FOR EACH ROW
  WHEN (OLD.stripe_onboarding_status IS DISTINCT FROM 'complete' AND NEW.stripe_onboarding_status = 'complete')
  EXECUTE FUNCTION public.fn_tr_product_available_on_connect_complete();
