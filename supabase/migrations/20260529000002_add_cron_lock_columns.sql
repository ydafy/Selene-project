-- Migration: Add concurrent execution lock columns for remaining crons
-- return_delivery_timeout_running: lock for return-delivery-timeout cron
-- release_funds_running: lock for release-funds cron
-- Same pattern as auto_cancel_orders_running / auto_cancel_preparing_running
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS return_delivery_timeout_running BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS release_funds_running BOOLEAN DEFAULT false;