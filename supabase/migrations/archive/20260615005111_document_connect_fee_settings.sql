-- ============================================================================
-- Migration: document_connect_fee_settings
-- Created: 2026-06-15
-- Description: Documents deprecated/legacy system_settings columns after the
--              Stripe Connect money-flow correction. Prevents destructive dropping
--              to maintain backward compatibility with old mobile app versions.
--
-- All changes are non-destructive (COMMENT ON COLUMN only).
-- ============================================================================

-- Document fee-related system settings after the Stripe Connect money-flow
-- correction. No columns are dropped here: legacy checkout and seller tooling
-- still reference these settings, so destructive cleanup is intentionally
-- deferred until usage can be audited safely.

COMMENT ON COLUMN public.system_settings.service_fee_pct IS
  'Legacy/Selene marketplace commission percentage. In Stripe Connect checkout this is a seller-side deduction, not a buyer charge.';

COMMENT ON COLUMN public.system_settings.service_fee_fixed_cents IS
  'Legacy fixed buyer service fee in centavos. Do not use for Stripe Connect buyer totals; v1 Connect checkout charges buyer subtotal + Seguro Selene only.';

COMMENT ON COLUMN public.system_settings.shipping_buffer_cents IS
  'Seller-side logistics buffer in centavos used by seller earnings estimates. Buyer does not pay seller shipping in Stripe Connect checkout.';
