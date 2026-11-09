/**
 * expo-push-notifications T13 appended the shipment to the order link of every shipment
 * notice (`|| COALESCE('?shipment_id=' || <shipment>::text, '')`, pinned in
 * shipment_notice_links.test.ts). Tests that compare an older migration with the
 * canonical file strip that suffix first, whether it sits on its own line or not.
 */
export const withoutShipmentLink = (sql: string) =>
  sql.replace(
    /\s*\|\| COALESCE\('\?shipment_id=' \|\| [\w.]+::text, ''\)/g,
    '',
  );

/**
 * T13 also made fn_resolve_dispute_to_buyer and its admin variant read the dispute's
 * shipment_id (one declaration and one column in their SELECT ... FOR UPDATE).
 */
export const withoutVerdictShipmentRead = (sql: string) =>
  sql
    .replace(/(v_seller_id UUID;)\r?\n {4}v_shipment_id UUID;/, '$1')
    .replace(
      'SELECT order_id, status, buyer_id, seller_id, shipment_id',
      'SELECT order_id, status, buyer_id, seller_id',
    )
    .replace(
      'INTO v_order_id, v_status, v_buyer_id, v_seller_id, v_shipment_id',
      'INTO v_order_id, v_status, v_buyer_id, v_seller_id',
    );

/**
 * supabase-audit-security T2 (evidence_object_paths) added one evidence path check to
 * fn_seller_submit_return_evidence, pinned in
 * supabase/queries/return/__tests__/returnEvidencePaths.test.ts. Tests that compare
 * an older migration with the canonical file strip that block first.
 */
export const withoutEvidencePathCheck = (sql: string) =>
  sql.replace(
    /\r?\n {4}-- Evidence paths: [^\n]*\r?\n {4}IF EXISTS \([\s\S]*?'INVALID_EVIDENCE_PATH'::TEXT; RETURN;\r?\n {4}END IF;/,
    '',
  );
