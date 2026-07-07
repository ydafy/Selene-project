# Apply Progress: single-modal-multiseller-checkout

## Batch
- Corrective apply: checkout reservation / create-connect-payment bugfix

## Completed
- Fixed `usePaymentProcess.ts` to safely handle optional `rolledBack` before comparing it to `> 0`.
- Added a targeted checkout policy guard test proving buyer checkout still renders `SummaryBreakdown` and does not reference `SellerPaymentBreakdown`.
- Normalized `create-connect-payment` reservation handling so `fn_reserve_products` array-shaped RPC rows are accepted, `success:false` rows still raise `RESERVATION_FAILED`, and the Edge logs RPC shape/error details for diagnosis.
- Switched the frontend `create-connect-payment` request to send deduped `items[].productId` payloads, added backend request normalization for `items[]`/legacy `productIds`, and expanded reservation diagnostics with buyer id, product count, short product ids, RPC shape, success, and error metadata.

## Notes
- Scope stayed within checkout reservation / create-connect-payment only.
- Backend Edge Function code was adjusted; no Stripe transfer/release or frontend UI code changed.
- Frontend request builder now emits the contract shape the Edge Function expects (`items[].productId`) and dedupes repeated product ids before checkout.
