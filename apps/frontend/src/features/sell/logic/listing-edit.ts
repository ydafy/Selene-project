import {
  buildPublicationEconomicsSnapshot,
  type SellDraft,
} from '../store/use-sell-store';
import { normalize } from '@/features/sell/logic/compare';
import { pesosToCents } from '@/shared/utils/money/pesos-to-cents';

type EconomicsSettings = Parameters<
  typeof buildPublicationEconomicsSnapshot
>[0]['settings'];

type EditableListing = Pick<
  SellDraft,
  'images' | 'specifications' | 'category' | 'price' | 'shipping_cost'
>;

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
    pesosToCents(draft.price || '0') !== pesosToCents(original.price || '0') ||
    pesosToCents(draft.shipping_cost || '0') !==
      pesosToCents(original.shipping_cost || '0'),
});

/** The `publication_*` columns for the draft under the current settings. */
export const buildEditEconomicsFields = (
  draft: Pick<SellDraft, 'price' | 'shipping_cost'>,
  settings: EconomicsSettings,
) => {
  const snapshot = buildPublicationEconomicsSnapshot({
    priceCents: pesosToCents(draft.price),
    quoteCents: pesosToCents(draft.shipping_cost || '0'),
    settings,
  });
  return {
    publication_shipping_reserve_cents: snapshot.shippingReserveCents,
    publication_commission_rate: snapshot.commissionRate,
    publication_insurance_rate: snapshot.insuranceRate,
  };
};
