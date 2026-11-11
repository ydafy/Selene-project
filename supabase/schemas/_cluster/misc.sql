SELECT cron.schedule_in_database('account-closure-cleanup', '0 * * * *', 'select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/account-closure-cleanup'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''project_anon_jwt''),
      ''apikey'', (select decrypted_secret from vault.decrypted_secrets where name = ''project_anon_jwt''),
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''account_closure_cleanup_cron_secret'')
    ),
    body := ''{}''::jsonb
  )', 'postgres', NULL, true);

SELECT cron.schedule_in_database('auto-cancel-orders-job', '0 * * * *', 'select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/auto-cancel-orders'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''project_anon_jwt''),
      ''apikey'', (select decrypted_secret from vault.decrypted_secrets where name = ''project_anon_jwt''),
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''auto_cancel_orders_cron_secret'')
    ),
    body := ''{}''::jsonb
  )', 'postgres', NULL, true);

SELECT cron.schedule_in_database('auto-cancel-preparing-job', '30 * * * *', 'select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/auto-cancel-preparing'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''project_anon_jwt''),
      ''apikey'', (select decrypted_secret from vault.decrypted_secrets where name = ''project_anon_jwt''),
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''auto_cancel_orders_cron_secret'')
    ),
    body := ''{}''::jsonb,
    timeout_milliseconds := 120000
  )', 'postgres', NULL, true);

SELECT cron.schedule_in_database('checkout-recovery-worker-every-5-minutes', '*/5 * * * *', 'select net.http_post(
    url := trim((select decrypted_secret from vault.decrypted_secrets where name = ''checkout_recovery_worker_url'')) || ''/functions/v1/checkout-recovery-worker'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || trim((select decrypted_secret from vault.decrypted_secrets where name = ''checkout_recovery_worker_service_role_key'')),
      ''apikey'', trim((select decrypted_secret from vault.decrypted_secrets where name = ''checkout_recovery_worker_service_role_key''))
    ),
    body := ''{}''::jsonb
  )', 'postgres', NULL, true);

SELECT cron.schedule_in_database('complete-delivered-shipments', '*/5 * * * *', 'select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/complete-delivered-shipments'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''project_anon_jwt''),
      ''apikey'', (select decrypted_secret from vault.decrypted_secrets where name = ''project_anon_jwt''),
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''complete_delivered_shipments_cron_secret'')
    ),
    body := ''{}''::jsonb
  )', 'postgres', NULL, true);

SELECT cron.schedule_in_database('cron-watchdog-every-15-minutes', '*/15 * * * *', 'select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/cron-watchdog'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''project_anon_jwt''),
      ''apikey'', (select decrypted_secret from vault.decrypted_secrets where name = ''project_anon_jwt''),
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''cron_watchdog_cron_secret'')
    ),
    body := ''{}''::jsonb,
    timeout_milliseconds := 30000
  )', 'postgres', NULL, true);

SELECT cron.schedule_in_database('dispatch-push-every-minute', '*/1 * * * *', 'select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/dispatch-push'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''project_anon_jwt''),
      ''apikey'', (select decrypted_secret from vault.decrypted_secrets where name = ''project_anon_jwt''),
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''dispatch_push_cron_secret'')
    ),
    body := ''{}''::jsonb,
    timeout_milliseconds := 120000
  )', 'postgres', NULL, true);

SELECT cron.schedule_in_database('dispute-payout-timeout-job', '0 * * * *', 'select public.fn_cron_dispute_payout_timeout()', 'postgres', NULL, true);

SELECT cron.schedule_in_database('dispute-shipping-timeout-job', '0 * * * *', 'select public.fn_cron_dispute_shipping_timeout()', 'postgres', NULL, true);

SELECT cron.schedule_in_database('purge-cron-run-details', '0 3 * * *', 'delete from cron.job_run_details where end_time < now() - interval ''7 days''', 'postgres', NULL, true);

SELECT
  cron.schedule_in_database('purge-expired-reservations', '*/15 * * * *',
  'update public.products set status = ''VERIFIED'', reserved_at = null, updated_at = now() where status = ''RESERVED'' and reserved_at < now() - interval ''30 minutes''',
  'postgres', NULL, true);

SELECT cron.schedule_in_database('reconcile-connect-payments', '0 */6 * * *', 'select * from public.fn_reconcile_connect_payments()', 'postgres', NULL, true);

SELECT cron.schedule_in_database('reconcile-stripe-fees-every-5-minutes', '*/5 * * * *', 'select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''stripe_fee_worker_project_url'') || ''/functions/v1/reconcile-stripe-fees'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''stripe_fee_worker_service_role_jwt''),
      ''apikey'', (select decrypted_secret from vault.decrypted_secrets where name = ''stripe_fee_worker_service_role_jwt'')
    ),
    body := ''{}''::jsonb
  )', 'postgres', NULL, true);

SELECT cron.schedule_in_database('resume-pending-payouts', '*/5 * * * *', 'select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/resume-pending-payouts'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''project_anon_jwt''),
      ''apikey'', (select decrypted_secret from vault.decrypted_secrets where name = ''project_anon_jwt''),
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''resume_pending_payouts_cron_secret'')
    ),
    body := ''{}''::jsonb
  )', 'postgres', NULL, true);

SELECT cron.schedule_in_database('return-delivery-timeout', '0 * * * *', 'select * from public.fn_cron_return_delivery_timeout()', 'postgres', NULL, true);

SELECT cron.schedule_in_database('track-shipments-preparing', '*/5 * * * *', 'select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/track-shipments'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''track_shipments_cron_secret'')
    ),
    body := ''{"lane": "preparing"}''::jsonb
  )', 'postgres', NULL, true);

SELECT cron.schedule_in_database('track-shipments-shipped', '*/15 * * * *', 'select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/track-shipments'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''track_shipments_cron_secret'')
    ),
    body := ''{"lane": "shipped"}''::jsonb
  )', 'postgres', NULL, true);
