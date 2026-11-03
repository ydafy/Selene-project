/**
 * expo-push-notifications T13 appended the shipment to the order link of every shipment
 * notice (`|| COALESCE('?shipment_id=' || <shipment>::text, '')`, pinned in
 * shipment_notice_links.test.ts). Tests that compare an older migration with the
 * canonical file strip that suffix first.
 */
export const withoutShipmentLink = (sql: string) =>
  sql.replace(
    /\r?\n[ \t]*\|\| COALESCE\('\?shipment_id=' \|\| [\w.]+::text, ''\)/g,
    '',
  );
