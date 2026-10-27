import { resolveCancelOrderFailureToast } from '../utils/shipment-cancel-safety';

// fn_cancel_shipment returns the shipment's products to VERIFIED, so the
// seller's listings and every cached product (['product', id, userId]) go stale.
export const getCancelOrderSuccessInvalidationKeys = (
  orderId: string,
): readonly (readonly string[])[] => [
  ['order', orderId],
  ['my-purchases'],
  ['my-sales'],
  ['shipments', orderId],
  ['my-listings'],
  ['product'],
];

// These groups mean the shipment is no longer (or not yet) in the state the
// screen shows, so reload it instead of leaving a stale cancel button.
const STATE_CHANGED_FAILURE_GROUPS = ['notCancelable', 'busy', 'inProgress', 'review'];

export const getCancelOrderFailureInvalidationKeys = (
  orderId: string,
  error: unknown,
): readonly (readonly string[])[] => {
  const { messageKey } = resolveCancelOrderFailureToast(error);
  const group = messageKey.split('.').at(-2) ?? '';
  if (!STATE_CHANGED_FAILURE_GROUPS.includes(group)) return [];
  return [
    ['order', orderId],
    ['my-purchases'],
    ['my-sales'],
    ['shipments', orderId],
  ];
};
