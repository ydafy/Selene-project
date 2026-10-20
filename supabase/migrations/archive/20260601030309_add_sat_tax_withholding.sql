-- Migration: Add SAT tax withholding columns (ISR 1% + IVA 8%)
-- Safe for production: all new columns are nullable to avoid table locks

-- 1. order_items: per-item SAT withholding amount
ALTER TABLE public.order_items
  ADD COLUMN sat_tax_withholding NUMERIC;

COMMENT ON COLUMN public.order_items.sat_tax_withholding IS
  'Monto total de retención SAT (ISR + IVA) para este artículo. Calculado en fn_create_order_from_payment.';

-- 2. wallet_transactions: per-transaction withholding amount
ALTER TABLE public.wallet_transactions
  ADD COLUMN tax_withholding NUMERIC;

COMMENT ON COLUMN public.wallet_transactions.tax_withholding IS
  'Monto retenido por SAT en esta transacción (ISR 1% + IVA 8%).';

-- 3. system_settings: configurable withholding percentages
ALTER TABLE public.system_settings
  ADD COLUMN isr_withholding_pct NUMERIC DEFAULT 0.01,
  ADD COLUMN iva_withholding_pct NUMERIC DEFAULT 0.08;

COMMENT ON COLUMN public.system_settings.isr_withholding_pct IS
  'Porcentaje de retención ISR (Art. 113-A LISR). Default: 1% = 0.01';

COMMENT ON COLUMN public.system_settings.iva_withholding_pct IS
  'Porcentaje de retención IVA para plataformas tecnológicas. Default: 8% = 0.08';

-- 4. Seed defaults for existing row(s)
UPDATE public.system_settings
SET isr_withholding_pct = COALESCE(isr_withholding_pct, 0.01),
    iva_withholding_pct = COALESCE(iva_withholding_pct, 0.08)
WHERE id = 1;
