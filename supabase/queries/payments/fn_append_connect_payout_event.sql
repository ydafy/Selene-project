CREATE OR REPLACE FUNCTION public.fn_append_connect_payout_event(p_stripe_event_id text, p_event_type text, p_stripe_payout_id text, p_connect_payout_run_id uuid, p_stripe_created timestamp with time zone, p_observed_payout_status text, p_failure_code text DEFAULT NULL::text, p_failure_message text DEFAULT NULL::text, p_failure_balance_transaction text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted BOOLEAN;
BEGIN
  IF p_event_type NOT IN (
    'payout.created',
    'payout.updated',
    'payout.paid',
    'payout.failed',
    'payout.canceled'
  ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_PAYOUT_EVENT_TYPE';
  END IF;

  IF p_observed_payout_status NOT IN (
    'pending',
    'in_transit',
    'paid',
    'failed',
    'canceled'
  ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_OBSERVED_PAYOUT_STATUS';
  END IF;

  INSERT INTO public.connect_payout_events (
    stripe_event_id,
    event_type,
    stripe_payout_id,
    connect_payout_run_id,
    stripe_created,
    received_at,
    observed_payout_status,
    failure_code,
    failure_message,
    failure_balance_transaction
  ) VALUES (
    p_stripe_event_id,
    p_event_type,
    p_stripe_payout_id,
    p_connect_payout_run_id,
    p_stripe_created,
    now(),
    p_observed_payout_status,
    p_failure_code,
    p_failure_message,
    p_failure_balance_transaction
  )
  ON CONFLICT (stripe_event_id) DO NOTHING
  RETURNING TRUE INTO v_inserted;

  RETURN COALESCE(v_inserted, FALSE);
END;
$function$
