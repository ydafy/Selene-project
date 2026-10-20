-- Migration: Drop legacy order-level RPC functions (replaced by shipment-level)
DROP FUNCTION IF EXISTS public.fn_mark_as_delivered(p_order_id UUID);
DROP FUNCTION IF EXISTS public.fn_mark_return_as_delivered(p_dispute_id UUID);
DROP FUNCTION IF EXISTS public.fn_release_order_funds(p_order_id UUID);
DROP FUNCTION IF EXISTS public.fn_complete_dispute_refund(p_order_id UUID, p_dispute_id UUID);
DROP FUNCTION IF EXISTS public.fn_confirm_return_receipt(p_dispute_id UUID);
