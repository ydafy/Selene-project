SET local check_function_bodies = off;

DROP TRIGGER "tr_orders_updated_at" ON "public"."orders";

DROP FUNCTION "public"."update_updated_at_column"();

CREATE OR REPLACE FUNCTION internal.fn_set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
  -- An update that sets updated_at on purpose (a cron or Edge Function stamping
  -- the time of the event it records) keeps that value; any other update moves
  -- it to now().
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER account_closures_set_updated_at
  BEFORE UPDATE ON internal.account_closures
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_set_updated_at();

CREATE TRIGGER checkout_recovery_shells_set_updated_at
  BEFORE UPDATE ON internal.checkout_recovery_shells
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_set_updated_at();

CREATE TRIGGER connect_account_actionability_set_updated_at
  BEFORE UPDATE ON internal.connect_account_actionability
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_set_updated_at();

CREATE TRIGGER stripe_fee_reconciliation_jobs_set_updated_at
  BEFORE UPDATE ON internal.stripe_fee_reconciliation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_set_updated_at();

CREATE TRIGGER category_configurations_set_updated_at
  BEFORE UPDATE ON public.category_configurations
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_set_updated_at();

CREATE TRIGGER connect_payout_run_shipments_set_updated_at
  BEFORE UPDATE ON public.connect_payout_run_shipments
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_set_updated_at();

CREATE TRIGGER connect_payout_runs_set_updated_at
  BEFORE UPDATE ON public.connect_payout_runs
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_set_updated_at();

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_set_updated_at();

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_set_updated_at();

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_set_updated_at();

CREATE TRIGGER profiles_private_set_updated_at
  BEFORE UPDATE ON public.profiles_private
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_set_updated_at();

CREATE TRIGGER push_deliveries_set_updated_at
  BEFORE UPDATE ON public.push_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_set_updated_at();

CREATE TRIGGER push_tokens_set_updated_at
  BEFORE UPDATE ON public.push_tokens
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_set_updated_at();

CREATE TRIGGER system_settings_set_updated_at
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_set_updated_at();

REVOKE ALL ON FUNCTION "internal"."fn_set_updated_at"() FROM PUBLIC;
