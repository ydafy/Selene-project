-- ============================================================================
-- product.interest: tell sellers when buyers save a listing they cannot sell yet.
--
-- Why: the product dialogs send buyers to favorites when a listing is not
-- purchasable. The seller should learn about that interest and what finishes
-- the happy path: send proofs (PENDING_VERIFICATION), wait for the review
-- (IN_REVIEW) or activate Stripe payments (VERIFIED, seller not ready).
-- Milestones 1, 5, 10 and 25 keep it an action nudge, never a per-favorite
-- stream. The notice is anonymous: no buyer id, name or per-person data.
--
-- Grant review (AGENTS.md): the helper and the trigger function are SECURITY
-- DEFINER because they read other users' favorites and profiles_private and
-- write a notice for another user. Only the trigger and server code call
-- them, so EXECUTE is revoked from PUBLIC, anon and authenticated; the helper
-- is granted to service_role only. Trigger functions need no grant: PostgreSQL
-- checks EXECUTE only when the trigger is created. No client may fabricate a
-- notice for another user.
--
-- Catalogue: the remote project is shared by all branches, so the list keeps
-- every kind already allowed there, including shipment.refund_failed from the
-- shipment-cancellations branch (20261022005940) and product.available from
-- the previous migration. Never drop a kind when adding one.
--
-- Canonical definitions: supabase/queries/products/fn_notify_product_interest.sql
-- and fn_tr_product_interest_on_favorite.sql
-- ============================================================================

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_event_kind_catalogue_chk,
  ADD CONSTRAINT notifications_event_kind_catalogue_chk
    CHECK (event_kind IS NULL OR event_kind IN (
      'order.payment_confirmed',
      'shipment.cancelled',
      'shipment.refund_failed',
      'dispute.opened',
      'dispute.verdict',
      'product.approved',
      'product.approved_with_note',
      'product.rejected',
      'return.seller_evidence_submitted',
      'return.delivered',
      'product.available',
      'product.interest'
    ));

CREATE OR REPLACE FUNCTION public.fn_notify_product_interest(p_product_id UUID, p_favoriter_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_ready boolean;
  v_count integer;
  v_milestone integer;
  v_title text;
  v_lead text;
  v_follow_up text;
  v_action_path text;
BEGIN
  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND deleted_at IS NULL;

  IF NOT FOUND OR v_product.seller_id = p_favoriter_id THEN
    RETURN;
  END IF;

  SELECT COALESCE(
    pp.stripe_account_id IS NOT NULL
      AND pp.stripe_onboarding_status = 'complete'
      AND pp.status IS DISTINCT FROM 'suspended'
      AND pp.status IS DISTINCT FROM 'banned',
    false
  )
  INTO v_ready
  FROM public.profiles_private pp
  WHERE pp.id = v_product.seller_id;

  IF v_product.status = 'PENDING_VERIFICATION' THEN
    v_follow_up := ' Envía tus pruebas para empezar a venderlo.';
    v_action_path := '/verify/' || v_product.id::text;
  ELSIF v_product.status = 'IN_REVIEW' THEN
    v_follow_up := ' Lo estamos revisando; te avisaremos al terminar.';
    v_action_path := '/profile/listings';
  ELSIF v_product.status = 'VERIFIED' AND NOT COALESCE(v_ready, false) THEN
    v_follow_up := ' Activa tus pagos para poder venderlo.';
    v_action_path := '/sell/onboarding';
  ELSE
    RETURN;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.favorites
  WHERE product_id = v_product.id
    AND user_id <> v_product.seller_id;

  v_milestone := CASE
    WHEN v_count >= 25 THEN 25
    WHEN v_count >= 10 THEN 10
    WHEN v_count >= 5 THEN 5
    WHEN v_count >= 1 THEN 1
  END;

  IF v_milestone IS NULL THEN
    RETURN;
  END IF;

  IF v_milestone = 1 THEN
    v_title := 'Tu producto genera interés';
    v_lead := 'Alguien guardó tu ' || v_product.name || ' en favoritos.';
  ELSE
    v_title := '¡Ya son ' || v_milestone::text || ' personas interesadas!';
    v_lead := v_milestone::text || ' personas guardaron tu ' || v_product.name || ' en favoritos.';
  END IF;

  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    title, message, type, read, action_path
  )
  VALUES (
    v_product.seller_id,
    'product.interest',
    'product.interest:' || v_product.id::text || ':' || v_milestone::text,
    jsonb_build_object('product_id', v_product.id, 'recipient_role', 'seller', 'milestone', v_milestone),
    v_title,
    v_lead || v_follow_up,
    'info',
    false,
    v_action_path
  )
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
END;
$$;

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

REVOKE EXECUTE ON FUNCTION public.fn_notify_product_interest(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_notify_product_interest(UUID, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_tr_product_interest_on_favorite() FROM PUBLIC, anon, authenticated;
