-- Migration: Add preparing_expiration_hours to system_settings
-- Separate timeout for shipments in 'preparing' status (label generated but no carrier scan)
-- 72h balances buyer experience (don't wait too long) with seller reality (carrier scan delays)
-- Configurable from dashboard without deploy — bump to 96h if cancelaciones injustas detected
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS preparing_expiration_hours INT DEFAULT 72;