import { expect, test } from 'bun:test';

const path = new URL('../notification_cutover_preflight.sql', import.meta.url);

test('supplemental cutover diagnostic is a bounded read-only catalog SELECT', async () => {
  const sql = await Bun.file(path).text();
  const statements = sql.replace(/^\s*--[^\n]*$/gm, '').trim();
  expect(statements).toMatch(/^SELECT\b/i);
  expect(statements).toMatch(/;\s*$/);
  expect((statements.match(/;/g) ?? []).length).toBe(1);
  expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|REVOKE|GRANT|TRUNCATE|CALL|DO|EXECUTE|PERFORM)\s+(?:INTO|ON|TABLE|FUNCTION|POLICY|INDEX|FROM|public\.)/i);
  expect(sql).not.toMatch(/pg_get_functiondef|\b(?:command|jobname|event_payload)\s*(?:AS|,|\))/i);
  expect(sql).not.toMatch(/FROM\s+public\.notifications\b/i);
  for (const key of ['event_kind', 'source_event_key', 'event_payload', 'pronargdefaults', 'prosecdef', 'proconfig', 'has_function_privilege', 'has_table_privilege', 'has_column_privilege', 'indisvalid', 'indisready', 'indisunique', 'tgenabled']) {
    expect(sql).toContain(key);
  }
  for (const signature of ['fn_cancel_order(uuid,text,text)', 'fn_cancel_shipment(uuid,text,text,bigint)', 'fn_complete_shipment_refund(uuid)', 'fn_create_order_from_payment(uuid,text,numeric,numeric,uuid,uuid[])', 'fn_create_shipments_from_single_payment(text,text,bigint,text,jsonb)', 'fn_cron_dispute_payout_timeout()', 'fn_cron_dispute_shipping_timeout()', 'fn_cron_return_delivery_timeout()', 'fn_mark_return_delivered(uuid)', 'fn_request_payout(numeric,uuid)', 'fn_resolve_dispute_to_buyer(uuid,text)', 'fn_resolve_dispute_to_seller(uuid,text)', 'fn_resolve_product_verdict(uuid,text,text,text)', 'fn_seller_submit_return_evidence(uuid,text[],text)']) {
    expect(sql).toContain(signature);
  }
  expect(sql).toContain('search_path=public, pg_temp');
  expect(sql).toContain('pronargdefaults = 1');
  expect(sql).toMatch(/'triggers'[\s\S]*?tgrelid=to_regclass\('public\.disputes'\)/);
  for (const name of ['set_product_in_dispute', 'notify_dispute_opened', 'tr_on_dispute_opened']) expect(sql).toContain(`'${name}'`);
  for (const field of ['tgenabled', 'tgfoid::regprocedure', 'tgtype & 5', 'tgtype & 2', 'fn_notify_dispute_opened()', 'notifications_event_payload_object_chk', 'notifications_event_identity_pair_chk', 'notifications_source_event_key_nonempty_chk', 'notifications_event_kind_catalogue_chk', 'convalidated', 'notifications_source_event_key_user_id_uidx', 'indimmediate', 'indnkeyatts', 'indnatts', 'indkey[0]', 'indkey[1]', 'pg_get_expr(i.indpred, i.indrelid)', 'n5a_arbiter_matches']) expect(sql).toContain(field);
  for (const role of ["'anon'", "'authenticated'", "'service_role'"]) expect(sql).toContain(role);
});
