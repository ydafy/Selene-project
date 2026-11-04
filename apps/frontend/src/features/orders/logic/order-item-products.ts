/**
 * Order and shipment details serve buyers and sellers. The table embed answers
 * only for the listing owner (or an admin), including RESERVED/IN_DISPUTE
 * rows; the public view answers for everyone else. Embed both and merge them
 * with `mergeItemProducts`.
 */
export const ITEM_PRODUCT_EMBED =
  'product:products(*), public_product:products_public(*)';

/** Folds `public_product` into `product` on every order item, at any depth. */
export const mergeItemProducts = <T>(node: T): T => {
  if (Array.isArray(node)) {
    node.forEach(mergeItemProducts);
  } else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if ('public_product' in record) {
      record.product = record.product ?? record.public_product;
      delete record.public_product;
    }
    Object.values(record).forEach(mergeItemProducts);
  }
  return node;
};
