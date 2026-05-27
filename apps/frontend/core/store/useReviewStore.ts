import { create } from 'zustand';

interface ReviewStore {
  ignoredOrderIds: string[];
  ignoreOrder: (id: string) => void;
  resetIgnored: () => void;
}

export const useReviewStore = create<ReviewStore>((set) => ({
  ignoredOrderIds: [],
  ignoreOrder: (id) =>
    set((state) => ({
      ignoredOrderIds: [...state.ignoredOrderIds, id],
    })),
  resetIgnored: () => set({ ignoredOrderIds: [] }),
}));
