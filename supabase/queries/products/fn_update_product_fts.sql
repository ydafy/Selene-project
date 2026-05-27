
DECLARE
  v_specs_text TEXT := '';
BEGIN
  -- A. NULL SAFETY: Extraemos valores del JSONB solo si no es nulo
  -- Esto permite buscar por "8GB" o "NVIDIA" aunque estén dentro del JSONB
  IF NEW.specifications IS NOT NULL AND NEW.specifications != '{}'::jsonb THEN
    SELECT string_agg(value, ' ') INTO v_specs_text
    FROM jsonb_each_text(NEW.specifications);
  END IF;

  -- B. CONSTRUCCIÓN DEL ÍNDICE (Diccionario 'simple')
  -- Combinamos Nombre, Categoría, Descripción y Especificaciones
  NEW.fts :=
    to_tsvector('simple', coalesce(NEW.name, '')) ||
    to_tsvector('simple', coalesce(NEW.category, '')) ||
    to_tsvector('simple', coalesce(NEW.description, '')) ||
    to_tsvector('simple', coalesce(v_specs_text, ''));

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Caja Negra: Si el buscador falla, logueamos el error pero no bloqueamos la venta
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_update_product_fts',
          jsonb_build_object('product_id', NEW.id, 'error', SQLERRM));

  RETURN NEW;
END;
