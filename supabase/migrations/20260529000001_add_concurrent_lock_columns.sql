-- Migration: Add concurrent execution lock columns to system_settings
-- Prevents overlapping cron runs when a batch takes longer than the cron interval
-- auto_cancel_orders_running: lock for auto-cancel-orders cron
-- auto_cancel_preparing_running: lock for auto-cancel-preparing cron
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS auto_cancel_orders_running BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_cancel_preparing_running BOOLEAN DEFAULT false;