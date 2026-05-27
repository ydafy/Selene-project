
DECLARE
  v_statuses public.order_status_enum[];
BEGIN
  -- Obtenemos de forma fidedigna (bypassando RLS) todos los estados de los paquetes del pedido
  SELECT array_agg(DISTINCT s.status)
  INTO v_statuses
  FROM public.shipments s
  WHERE s.order_id = p_order_id;

  -- Si se calcula antes de que se creen los shipments, se asume pendiente
  IF v_statuses IS NULL THEN
    RETURN 'pending';
  END IF;

  -- 1. Estados excepcionales (cualquier shipment afectado contamina el estado global por seguridad)
  IF 'dispute'    = ANY(v_statuses) THEN RETURN 'dispute';  END IF;
  IF 'refunded'   = ANY(v_statuses) THEN RETURN 'refunded'; END IF;
  IF 'cancelled'  = ANY(v_statuses) THEN RETURN 'cancelled'; END IF;

  -- 2. Progreso logístico (el cuello de botella o paquete menos avanzado manda en la visualización general)
  IF 'paid'       = ANY(v_statuses) THEN RETURN 'paid';      END IF;
  IF 'preparing'  = ANY(v_statuses) THEN RETURN 'preparing'; END IF;
  IF 'shipped'    = ANY(v_statuses) THEN RETURN 'shipped';   END IF;
  IF 'delivered'  = ANY(v_statuses) THEN RETURN 'delivered'; END IF;

  -- 3. Todos los paquetes completados de forma unánime
  IF 'completed'  = ALL(v_statuses) THEN RETURN 'completed'; END IF;

  RETURN 'paid';
END;
