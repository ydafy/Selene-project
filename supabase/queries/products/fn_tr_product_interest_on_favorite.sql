-- fn_tr_product_interest_on_favorite
-- Introduced by *_product_interest_notification.sql (grants and rationale live
-- there).
--
-- Runs after every favorite insert and hands the listing and the favoriter to
-- fn_notify_product_interest, which decides whether a milestone notice is due.

CREATE OR REPLACE FUNCTION public.fn_tr_product_interest_on_favorite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The favorite is the buyer's own action and the seller notice is best
  -- effort: a failing notice rolls back only its own subtransaction.
  BEGIN
    PERFORM public.fn_notify_product_interest(NEW.product_id, NEW.user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'product.interest notice skipped for product %: %', NEW.product_id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_interest_on_favorite ON public.favorites;
CREATE TRIGGER trg_product_interest_on_favorite
  AFTER INSERT ON public.favorites
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_tr_product_interest_on_favorite();
