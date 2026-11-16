SET local check_function_bodies = off;

SELECT cron.schedule_in_database('purge-old-evidence', '0 9 * * *', 'select internal.fn_track_cron_request(''purge-old-evidence'', net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = ''project_url'') || ''/functions/v1/purge-old-evidence'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''purge_old_evidence_cron_secret'')
    ),
    body := ''{}''::jsonb,
    timeout_milliseconds := 120000
  ))', 'postgres', NULL, true);
