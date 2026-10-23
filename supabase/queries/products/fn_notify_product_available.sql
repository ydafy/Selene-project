-- fn_notify_product_available
-- Introduced by 20261023004035_product_available_notification.sql (grants and
-- rationale live there).
--
-- Tells every buyer who favorited a listing that it can be bought now. A
-- listing qualifies only when it is purchasable at this moment: live VERIFIED
-- and its seller can receive payments (same rules as
-- fn_product_seller_payment_readiness). The seller never receives it. One
-- notice per buyer per listing, ever: repeated calls hit the unique
-- (source_event_key, user_id) index and do nothing.

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
