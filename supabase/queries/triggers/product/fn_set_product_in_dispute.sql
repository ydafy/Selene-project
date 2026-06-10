
DECLARE
  v_product_id UUID;
BEGIN
  IF NEW.shipment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT oi.product_id INTO v_product_id
  FROM public.shipments s
  JOIN public.order_items oi ON oi.shipment_id = s.id
  WHERE s.id = NEW.shipment_id
  LIMIT 1;

  IF v_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.products
  SET status = 'IN_DISPUTE'::public.product_status_enum,
      updated_at = now()
  WHERE id = v_product_id
    AND deleted_at IS NULL
    AND status NOT IN ('SOLD'::public.product_status_enum, 'RESERVED'::public.product_status_enum);

  RETURN NEW;
END;
