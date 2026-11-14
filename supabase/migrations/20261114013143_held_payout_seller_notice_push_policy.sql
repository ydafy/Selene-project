-- shipment.payout_blocked is pushed to the seller on the orders channel (#549,
-- odd/tasks/held-payout-seller-notice.md T2, S2). Data only: the declarative
-- schema cannot hold rows. The kind and its producer are in
-- 20261114013132_held_payout_seller_notice.sql.
INSERT INTO public.push_event_policy (event_kind, recipient_role, channel) VALUES
  ('shipment.payout_blocked', 'seller', 'orders');
