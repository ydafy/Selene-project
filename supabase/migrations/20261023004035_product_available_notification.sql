-- ============================================================================
-- product.available: tell buyers when a favorited listing becomes purchasable.
--
-- Why: the product dialogs promise "add it to favorites to be notified when it
-- is available". Purchasable means VERIFIED and the seller can receive
-- payments, so two events can complete it: the listing leaving the
-- verification queue (products.status -> VERIFIED) and the seller finishing
-- Stripe Connect (profiles_private.stripe_onboarding_status -> 'complete').
-- Both call one helper that inserts a typed notice per favoriter, never the
-- seller, once per buyer per listing (unique source_event_key + user_id).
--
-- Grant review (AGENTS.md): all three functions are SECURITY DEFINER because
-- they write notifications for other users and read profiles_private.
-- Only triggers and server code call them, so EXECUTE is revoked from PUBLIC,
-- anon and authenticated; the helper is granted to service_role only. Trigger
-- functions need no grant: PostgreSQL checks EXECUTE only when the trigger is
-- created. No client may fabricate a notice for another user.
--
-- Catalogue: the list keeps every kind already allowed on the shared remote
-- project, including shipment.refund_failed from the shipment-cancellations
-- branch (20261022005940), which sorts before this migration. Replacing the
-- constraint without it would break that producer.
--
-- Canonical definitions: supabase/queries/products/fn_notify_product_available.sql,
-- fn_tr_product_available_on_verify.sql and
-- fn_tr_product_available_on_connect_complete.sql
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
      'product.available'
    ));

CREATE OR REPLACE FUNCTION public.fn_notify_product_available(p_product_ids UUID[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    title, message, type, read, action_path
  )
  SELECT
    f.user_id,
    'product.available',
    'product.available:' || p.id::text,
    jsonb_build_object('product_id', p.id, 'recipient_role', 'buyer'),
    '¡Ya puedes comprarlo!',
    p.name || ' ya está disponible en Selene.',
    'success',
    false,
    '/product/' || p.id::text
  FROM public.products p
  JOIN public.profiles_private pp ON pp.id = p.seller_id
  JOIN public.favorites f ON f.product_id = p.id
  WHERE p.id = ANY(p_product_ids)
    AND p.status = 'VERIFIED'
    AND p.deleted_at IS NULL
    AND pp.stripe_account_id IS NOT NULL
    AND pp.stripe_onboarding_status = 'complete'
    AND pp.status IS DISTINCT FROM 'suspended'
    AND pp.status IS DISTINCT FROM 'banned'
    AND f.user_id <> p.seller_id
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
END;
$$;

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

REVOKE EXECUTE ON FUNCTION public.fn_notify_product_available(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_notify_product_available(UUID[]) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_tr_product_available_on_verify() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_tr_product_available_on_connect_complete() FROM PUBLIC, anon, authenticated;
