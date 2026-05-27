import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MIN_DESCRIPTION_LENGTH } from '../constants/disputeChecklists';
import { Enums } from '@selene/types';

export type DisputeReason = Enums<'dispute_reason'>;

interface DisputeState {
  currentStep: number;
  checklist: Record<string, boolean>;
  reason: DisputeReason | null;
  description: string;
  images: string[];
  videoUrl: string | null;
  setVideoUrl: (url: string | null) => void;

  setStep: (step: number) => void;
  toggleCheck: (id: string) => void;
  setReason: (reason: DisputeReason) => void;
  setDescription: (desc: string) => void;
  setImages: (urls: string[]) => void;
  isStepValid: (step: number, requiredChecksCount: number) => boolean;
  reset: () => void;
}

export const useDisputeStore = create<DisputeState>()(
  persist(
    (set, get) => ({
      currentStep: 0,
      checklist: {},
      reason: null,
      description: '',
      images: [],
      videoUrl: null,
      setVideoUrl: (url) => set({ videoUrl: url }),

      setStep: (step) => set({ currentStep: step }),

      toggleCheck: (id) =>
        set((state) => ({
          checklist: { ...state.checklist, [id]: !state.checklist[id] },
        })),

      setReason: (reason) => set({ reason }),
      setDescription: (description) => set({ description }),
      setImages: (images) => set({ images }),

      isStepValid: (step, requiredChecksCount) => {
        const state = get();
        switch (step) {
          case 0: // Triage: Debe marcar TODAS las preguntas obligatorias
            const checkedCount = Object.values(state.checklist).filter(
              Boolean,
            ).length;
            return (
              checkedCount === requiredChecksCount && requiredChecksCount > 0
            );

          case 1: // Detalles
            return (
              !!state.reason &&
              state.description.trim().length >= MIN_DESCRIPTION_LENGTH
            );

          case 2: // Evidencia
            const hasImages = state.images.length >= 1;
            const hasVideo = !!state.videoUrl;
            return hasImages && hasVideo;

          default:
            return false;
        }
      },

      reset: () =>
        set({
          currentStep: 0,
          checklist: {},
          reason: null,
          description: '',
          images: [],
          videoUrl: null,
        }),
    }),
    {
      name: 'selene-dispute-storage',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
