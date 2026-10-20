alter table public.profiles_private
  add column if not exists stripe_onboarding_refreshed_at timestamptz;
