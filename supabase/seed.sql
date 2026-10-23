-- Local development seed. `supabase db reset` applies it after all migrations.
-- LOCAL ONLY: never run this against a remote project. Passwords are public.
--
-- Accounts (password for all: password123)
--   admin@selene.local   admin
--   seller@selene.local  verified seller with four published listings
--   buyer@selene.local   buyer with a default shipping address
--
-- Configuration rows mirror project acoiclkeymgtlwcxilun on 2026-10-20, with
-- every cron "running" flag reset to false.

-- System configuration --------------------------------------------------------

INSERT INTO public.system_settings (
  id, is_maintenance, min_version_android, min_version_ios,
  service_fee_pct, service_fee_fixed_cents, insurance_rate, payout_fee_fixed_cents,
  currency, shipping_buffer_cents, package_presets, return_label_fee_cents,
  order_expiration_hours, min_payout_amount_cents, preparing_expiration_hours,
  auto_cancel_orders_running, auto_cancel_preparing_running,
  return_delivery_timeout_running, release_funds_running,
  isr_withholding_pct, iva_withholding_pct, connect_enabled,
  novice_completed_threshold, novice_active_limit, trusted_active_limit,
  envia_carrier, envia_service, envia_print_format, envia_print_size,
  checkout_recovery_enabled, checkout_recovery_running
) VALUES (
  1, false, '1.0.0', '1.0.0',
  0.06, 0, 0.012, 200,
  'MXN', 3000,
  '{
    "cpu_1": {"label": "Con Disipador (Caja Original)", "width": 15, "height": 15, "length": 15, "weight": 1, "category": "CPU"},
    "cpu_2": {"label": "Solo Procesador (Sin Disipador)", "width": 15, "height": 8, "length": 20, "weight": 1, "category": "CPU"},
    "gpu_1": {"label": "Dual-Fan (2 Ventiladores)", "width": 25, "height": 15, "length": 35, "weight": 3, "category": "GPU"},
    "gpu_2": {"label": "Triple-Fan (3 Ventiladores)", "width": 32, "height": 18, "length": 44, "weight": 5, "category": "GPU"},
    "ram_1": {"label": "Blister / Caja Plana", "width": 15, "height": 6, "length": 20, "weight": 1, "category": "RAM"},
    "mobo_1": {"label": "Caja Estándar (ATX / M-ATX)", "width": 30, "height": 10, "length": 38, "weight": 3, "category": "Motherboard"}
  }'::jsonb,
  30000,
  48, 10000, 72,
  false, false,
  false, false,
  0.00, 0.00, false,
  3, 3, 10,
  'paquetexpress', 'ground', 'PDF', 'STOCK_4X6',
  true, false
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.category_configurations (category_name, sell_fields, filter_fields) VALUES
  ('CPU',
   '[{"name": "brand", "type": "select"}, {"name": "family", "type": "select"}, {"name": "model", "type": "select", "searchable": true}, {"name": "cores", "type": "select"}]',
   '[{"id": "brand", "label": "Marca", "options": ["Intel", "AMD", "Other"]}, {"id": "family", "label": "Familia", "options": ["Core i9", "Core i7", "Core i5", "Core i3", "Ryzen 9", "Ryzen 7", "Ryzen 5", "Ryzen 3", "Other"]}, {"id": "cores", "label": "Núcleos", "options": ["4", "6", "8", "12", "16", "24", "32"]}]'),
  ('GPU',
   '[{"name": "chipset", "type": "select", "label": "Chipset", "options": ["NVIDIA", "AMD", "Intel", "Other"]}, {"name": "brand", "type": "select", "label": "Marca", "options": ["ASUS", "MSI", "Gigabyte", "EVGA", "Zotac", "PNY", "Sapphire", "PowerColor", "XFX", "ASRock", "Other"]}, {"name": "model", "type": "select", "label": "Modelo", "dependsOn": "chipset", "searchable": true}, {"name": "memory", "type": "select", "label": "VRAM", "options": ["4 GB", "6 GB", "8 GB", "10 GB", "12 GB", "16 GB", "24 GB", "Other"]}]',
   '[{"id": "chipset", "label": "Chipset", "options": ["NVIDIA", "AMD", "Intel", "Other"]}, {"id": "brand", "label": "Marca", "options": ["ASUS", "MSI", "Gigabyte", "EVGA", "Zotac", "PNY", "Sapphire", "PowerColor", "XFX", "ASRock", "Other"]}, {"id": "memory", "label": "VRAM", "options": ["4 GB", "6 GB", "8 GB", "10 GB", "12 GB", "16 GB", "24 GB", "Other"]}]'),
  ('Motherboard',
   '[{"name": "brand", "type": "select"}, {"name": "socket", "type": "select"}, {"name": "form_factor", "type": "select"}, {"name": "chipset", "type": "select"}]',
   '[{"id": "brand", "label": "Marca", "options": ["ASUS", "MSI", "Gigabyte", "ASRock", "EVGA", "NZXT", "Other"]}, {"id": "socket", "label": "Socket", "options": ["AM5", "AM4", "LGA 1700", "LGA 1200", "LGA 1151", "Other"]}, {"id": "form_factor", "label": "Formato", "options": ["ATX", "E-ATX", "Micro-ATX", "Mini-ITX"]}]'),
  ('RAM',
   '[{"name": "brand", "type": "select"}, {"name": "type", "type": "select"}, {"name": "capacity", "type": "select"}, {"name": "speed", "type": "select"}]',
   '[{"id": "brand", "label": "Marca", "options": ["Corsair", "G.Skill", "Kingston", "ADATA (XPG)", "TeamGroup", "Crucial", "Samsung", "Other"]}, {"id": "type", "label": "Tipo", "options": ["DDR5", "DDR4", "DDR3"]}, {"id": "capacity", "label": "Capacidad", "options": ["8 GB", "16 GB", "32 GB", "64 GB", "128 GB"]}, {"id": "speed", "label": "Velocidad", "options": ["3200 MHz", "3600 MHz", "5200 MHz", "6000 MHz", "6400 MHz", "Other"]}]')
ON CONFLICT (category_name) DO NOTHING;

INSERT INTO public.mexico_banks (code, name, active) VALUES
  ('002', 'BANAMEX', true), ('012', 'BBVA', true), ('014', 'SANTANDER', true),
  ('021', 'HSBC', true), ('036', 'INBURSA', true), ('044', 'SCOTIABANK', true),
  ('058', 'BANREGIO', true), ('062', 'AFIRME', true), ('072', 'BANORTE', true),
  ('127', 'AZTECA', true), ('137', 'BANCOPPEL', true), ('143', 'CIBANCO', true),
  ('156', 'SABADELL', true), ('901', 'STP', true)
ON CONFLICT (code) DO NOTHING;

-- A small subset of the 154k postal codes, enough for the seeded addresses.
INSERT INTO public.mexico_zips (zip_code, district, city, state_name, state_code) VALUES
  ('06600', 'Juárez', 'Cuauhtémoc', 'Ciudad de México', 'CMX'),
  ('06700', 'Roma Norte', 'Cuauhtémoc', 'Ciudad de México', 'CMX'),
  ('44100', 'Guadalajara Centro', 'Guadalajara', 'Jalisco', 'JAL'),
  ('44600', 'Ladrón de Guevara', 'Guadalajara', 'Jalisco', 'JAL'),
  ('64000', 'Monterrey Centro', 'Monterrey', 'Nuevo León', 'NL'),
  ('64700', 'Tecnológico', 'Monterrey', 'Nuevo León', 'NL');

-- Accounts -------------------------------------------------------------------
-- tr_on_auth_user_created provisions profiles, profiles_private and wallets.

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
SELECT
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('username', u.username), now(), now(),
  '', '', '', ''
FROM (VALUES
  ('00000000-0000-4000-8000-000000000001'::uuid, 'admin@selene.local', 'selene_admin'),
  ('00000000-0000-4000-8000-000000000002'::uuid, 'seller@selene.local', 'hardware_seller'),
  ('00000000-0000-4000-8000-000000000003'::uuid, 'buyer@selene.local', 'pc_buyer')
) AS u(id, email, username);

INSERT INTO auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
SELECT
  gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
FROM auth.users u
WHERE u.email LIKE '%@selene.local';

UPDATE public.profiles_private
SET role = 'admin'
WHERE id = '00000000-0000-4000-8000-000000000001';

UPDATE public.profiles
SET is_verified_seller = true
WHERE id = '00000000-0000-4000-8000-000000000002';

-- The seller started Stripe Connect onboarding but has not finished it: the
-- account id exists while charges and payouts are not enabled yet. Checkout
-- must refuse this seller (bruno/functions/checkout-seller-onboarding-pending).
-- The id is a local placeholder, not a real Stripe account.
UPDATE public.profiles_private
SET stripe_account_id = 'acct_local_seller_pending',
    stripe_onboarding_status = 'pending'
WHERE id = '00000000-0000-4000-8000-000000000002';

INSERT INTO public.addresses (
  id, user_id, label, full_name, phone, street_line1, street_number,
  district, city, state, zip_code, is_default
) VALUES
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000002',
   'Taller', 'Vendedor Selene', '5511111111', 'Calle Liverpool', '120',
   'Juárez', 'Cuauhtémoc', 'Ciudad de México', '06600', true),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000003',
   'Casa', 'Comprador Selene', '3322222222', 'Avenida Chapultepec', '45',
   'Ladrón de Guevara', 'Guadalajara', 'Jalisco', '44600', true);

-- Listings -------------------------------------------------------------------
-- Publication economics are computed from system_settings with the same
-- formula as validate_product_publication_economics, so they stay valid if
-- the rates above change.

INSERT INTO public.products (
  id, name, description, price, category, condition, usage, images, status,
  specifications, seller_id, shipping_cost, origin_zip, package_preset,
  verified_at, publication_shipping_reserve_cents, publication_commission_rate,
  publication_insurance_rate
)
SELECT
  p.id, p.name, p.description, p.price, p.category, p.condition, p.usage,
  ARRAY['https://placehold.co/800x800/png?text=' || replace(p.name, ' ', '+')],
  'VERIFIED', p.specifications, '00000000-0000-4000-8000-000000000002',
  p.shipping_cost, '06600', p.package_preset, now(),
  round(p.shipping_cost * 100)::bigint
    + s.shipping_buffer_cents
    + ceil(round(p.price * 100)::numeric * public.normalize_publication_rate(s.insurance_rate))::bigint,
  public.normalize_publication_rate(s.service_fee_pct),
  public.normalize_publication_rate(s.insurance_rate)
FROM public.system_settings s
CROSS JOIN (VALUES
  ('00000000-0000-4000-8000-0000000000b1'::uuid, 'NVIDIA RTX 3070', 'Tarjeta usada, sin minería, con caja original.', 7500::numeric,
   'GPU', 'used', 'gaming', '{"chipset": "NVIDIA", "brand": "MSI", "model": "RTX 3070", "memory": "8 GB"}'::jsonb, 180::numeric, 'gpu_1'),
  ('00000000-0000-4000-8000-0000000000b2'::uuid, 'AMD Ryzen 7 5800X', 'Procesador funcionando al 100%, sin disipador.', 3900::numeric,
   'CPU', 'used', 'gaming', '{"brand": "AMD", "family": "Ryzen 7", "model": "5800X", "cores": "8"}'::jsonb, 120::numeric, 'cpu_2'),
  ('00000000-0000-4000-8000-0000000000b3'::uuid, 'Corsair Vengeance 32 GB DDR4', 'Kit 2x16 GB a 3600 MHz.', 1600::numeric,
   'RAM', 'used', 'office', '{"brand": "Corsair", "type": "DDR4", "capacity": "32 GB", "speed": "3600 MHz"}'::jsonb, 100::numeric, 'ram_1'),
  ('00000000-0000-4000-8000-0000000000b4'::uuid, 'ASUS TUF B550-PLUS', 'Tarjeta madre AM4 en caja original.', 2400::numeric,
   'Motherboard', 'used', 'gaming', '{"brand": "ASUS", "socket": "AM4", "form_factor": "ATX", "chipset": "B550"}'::jsonb, 150::numeric, 'mobo_1')
) AS p(id, name, description, price, category, condition, usage, specifications, shipping_cost, package_preset)
WHERE s.id = 1;
