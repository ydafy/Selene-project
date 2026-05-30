-- =========================================================================
-- RLS Policies for shipments table — PR 1 (Fase 9.1)
-- Orden de deploy: PRIMERO este archivo, luego cualquier Edge Function
-- que lea/escriba shipments con auth de usuario
-- =========================================================================
-- Dependencias: is_admin(), shipments, orders
-- =========================================================================

-- 1. Enable RLS (idempotent)
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- 2. SELECT policies
-- =========================================================================

-- Comprador: ve todos los shipments de su orden (incluye otros sellers)
-- Optimizado con EXISTS + scalar subquery para InitPlan de Supabase
CREATE POLICY "shipments_select_buyer" ON public.shipments
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND o.buyer_id = (SELECT auth.uid())
    )
  );

-- Vendedor: ve solo sus propios shipments
CREATE POLICY "shipments_select_seller" ON public.shipments
  FOR SELECT
  TO public
  USING (
    seller_id = (SELECT auth.uid())
  );

-- Admin: ve todo
CREATE POLICY "shipments_select_admin" ON public.shipments
  FOR SELECT
  TO public
  USING (
    is_admin()
  );

-- =========================================================================
-- 3. INSERT: solo service_role (Edge Functions).
-- =========================================================================
CREATE POLICY "shipments_insert_block" ON public.shipments
  FOR INSERT
  TO public
  WITH CHECK (false);

-- =========================================================================
-- 4. UPDATE policies
-- =========================================================================

-- Vendedor: puede actualizar tracking, label, origin_address, carrier
-- FIX: status bloqueado TAMBIÉN en USING para evitar que un seller
-- seleccione shipments ya delivered/completed y los degrade.
CREATE POLICY "shipments_update_seller" ON public.shipments
  FOR UPDATE
  TO public
  USING (
    seller_id = (SELECT auth.uid())
    AND status IN ('paid', 'preparing', 'shipped')
  )
  WITH CHECK (
    seller_id = (SELECT auth.uid())
    AND status IN ('paid', 'preparing', 'shipped')
  );

-- Admin: puede actualizar cualquier shipment
CREATE POLICY "shipments_update_admin" ON public.shipments
  FOR UPDATE
  TO public
  USING (
    is_admin()
  );

-- =========================================================================
-- 5. DELETE: bloqueado para todos. service_role bypassa RLS nativamente.
-- =========================================================================
CREATE POLICY "shipments_delete_block" ON public.shipments
  FOR DELETE
  TO public
  USING (false);
