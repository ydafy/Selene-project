import {
  buildPublicationEconomicsSnapshot,
  type SellDraft,
} from '../store/use-sell-store';
import { normalize } from '@/shared/utils/compare';

type EconomicsSettings = Parameters<
  typeof buildPublicationEconomicsSnapshot
>[0]['settings'];

type EditableListing = Pick<
  SellDraft,
  'images' | 'specifications' | 'category' | 'price' | 'shipping_cost'
>;

const toCents = (value: string | undefined): number =>
  Math.round(parseFloat(value || '0') * 100);

/**
 * Classifies an edit against the listing as it was loaded.
 * Sacred changes (images, specifications, category) invalidate the
 * verification. Economics changes (price, shipping cost) are a new deal and
 * need a fresh publication snapshot.
 */
export const classifyListingEdit = (
  draft: EditableListing,
  original: EditableListing,
): { sacredChanges: boolean; economicsChanges: boolean } => ({
  sacredChanges:
    JSON.stringify(normalize(draft.images)) !==
      JSON.stringify(normalize(original.images)) ||
    JSON.stringify(normalize(draft.specifications)) !==
      JSON.stringify(normalize(original.specifications)) ||
    draft.category !== original.category,
  economicsChanges:
    toCents(draft.price) !== toCents(original.price) ||
    toCents(draft.shipping_cost) !== toCents(original.shipping_cost),
});

/** The `publication_*` columns for the draft under the current settings. */
export const buildEditEconomicsFields = (
  draft: Pick<SellDraft, 'price' | 'shipping_cost'>,
  settings: EconomicsSettings,
) => {
  const snapshot = buildPublicationEconomicsSnapshot({
    priceCents: Math.round(parseFloat(draft.price) * 100),
    quoteCents: Math.round(parseFloat(draft.shipping_cost) * 100),
    settings,
  });
  return {
    publication_shipping_reserve_cents: snapshot.shippingReserveCents,
    publication_commission_rate: snapshot.commissionRate,
    publication_insurance_rate: snapshot.insuranceRate,
  };
};
