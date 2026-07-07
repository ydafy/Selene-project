import { describe, expect, it, beforeEach } from 'bun:test';

import { useSellStore } from './useSellStore';

describe('useSellStore', () => {
  beforeEach(() => {
    useSellStore.getState().resetDraft();
  });

  describe('setCategory', () => {
    it('resets condition, usage, and specifications when category changes', () => {
      const { setCategory, updateDraft } = useSellStore.getState();

      setCategory('GPU');
      updateDraft({
        condition: 'Used - Like New',
        usage: '6_months',
        specifications: { chipset: 'NVIDIA', memory: '12 GB' },
      });

      setCategory('CPU');

      const { draft } = useSellStore.getState();
      expect(draft.category).toBe('CPU');
      expect(draft.condition).toBe('');
      expect(draft.usage).toBe('');
      expect(draft.specifications).toEqual({});
    });

    it('does not reset dependent fields when category is unchanged', () => {
      const { setCategory, updateDraft } = useSellStore.getState();

      setCategory('GPU');
      updateDraft({
        condition: 'Used - Like New',
        usage: '6_months',
        specifications: { chipset: 'NVIDIA', memory: '12 GB' },
      });

      setCategory('GPU');

      const { draft } = useSellStore.getState();
      expect(draft.category).toBe('GPU');
      expect(draft.condition).toBe('Used - Like New');
      expect(draft.usage).toBe('6_months');
      expect(draft.specifications).toEqual({
        chipset: 'NVIDIA',
        memory: '12 GB',
      });
    });

    it('keeps non-dependent fields intact on category change', () => {
      const { setCategory, updateDraft } = useSellStore.getState();

      setCategory('GPU');
      updateDraft({
        name: 'RTX 3080',
        price: '12500',
        description: 'Great card',
        images: ['file://photo.jpg'],
        condition: 'Used - Like New',
        specifications: { chipset: 'NVIDIA' },
      });

      setCategory('CPU');

      const { draft } = useSellStore.getState();
      expect(draft.name).toBe('RTX 3080');
      expect(draft.price).toBe('12500');
      expect(draft.description).toBe('Great card');
      expect(draft.images).toEqual(['file://photo.jpg']);
      expect(draft.condition).toBe('');
      expect(draft.specifications).toEqual({});
    });
  });
});
