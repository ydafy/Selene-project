// Query keys shared by the payments hooks, kept apart so a hook can refresh
// another hook's query without importing it.

export const CONNECT_PAYOUT_RELEASE_QUEUE_KEY = [
  'connect-payout-release-queue',
] as const;

export const SHIPMENT_REFUND_PROBLEMS_KEY = [
  'shipment-refund-problems',
] as const;
