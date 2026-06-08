-- =========================================================================
-- fn_set_product_in_dispute — SECURITY INVOKER trigger function
-- Fires AFTER INSERT ON disputes.
-- Looks up product via: disputes.shipment_id → shipments.id → order_items.product_id
-- Skips if: deleted_at IS NOT NULL OR status IN ('SOLD', 'RESERVED')
-- Idempotent: re-inserting for same product will not downgrade.
-- REQ-PDS-002
-- =========================================================================

CREATE OR REPLACE FUNCTION public.fn_set_product_in_dispute()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_id UUID;
BEGIN
  -- Skip if no shipment linked
  IF NEW.shipment_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve product via shipment → order_items join
  SELECT oi.product_id INTO v_product_id
  FROM public.shipments s
  JOIN public.order_items oi ON oi.shipment_id = s.id
  WHERE s.id = NEW.shipment_id
  LIMIT 1;

  IF v_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip soft-deleted products and terminal statuses (SOLD, RESERVED)
  -- Do not downgrade from a higher-priority status
  UPDATE public.products
  SET status = 'IN_DISPUTE',
      updated_at = now()
  WHERE id = v_product_id
    AND deleted_at IS NULL
    AND status NOT IN ('SOLD', 'RESERVED');

  RETURN NEW;
END;
$$;