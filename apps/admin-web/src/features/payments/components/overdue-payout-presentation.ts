// Shared presentation of the overdue payout card and its dialogs.

import { workbenchFocus } from '@/shared/ui/workbench-focus';
import { centsToMoney } from '@/shared/utils/cents-to-money';
import { formatCurrency } from '@/shared/utils/format-currency';
import type { OverduePayout } from '../logic/connect-payout-release-queue';

export const shortId = (id: string) => id.slice(0, 8);
export const money = (cents: number) => formatCurrency(centsToMoney(cents));
export const sellerLabel = (payout: OverduePayout) =>
  payout.sellerName ? `@${payout.sellerName}` : payout.sellerId;
export const secondary = `rounded-xl border border-white/10 px-4 py-2.5 text-xs font-semibold text-platinum transition-colors hover:border-lion/50 disabled:cursor-not-allowed disabled:opacity-40 ${workbenchFocus}`;
export const danger = `rounded-xl bg-fire px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-fire/90 disabled:cursor-not-allowed disabled:opacity-40 ${workbenchFocus}`;
