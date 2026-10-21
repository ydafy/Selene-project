import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { queryClient } from '../lib/queryClient';
import { adminAccessMessage, type AdminAccessDenial } from '../lib/adminAccess';
import {
  createLoadGuard,
  resolveAdminSession,
  type AdminSessionOutcome,
} from '../lib/adminSession.logic';

export interface AdminProfile {
  id: string;
  username: string | null;
  avatar_url: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
  is_verified_seller: boolean | null;
  created_at: string;
  available_balance: number;
  pending_balance: number;
}

interface AuthState {
  user: User | null;
  profile: AdminProfile | null;
  loading: boolean;
  initialized: boolean;
  evaluateAccess: (user: User) => Promise<AdminSessionOutcome<AdminProfile>>;
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
}

async function fetchAdminProfile(userId: string): Promise<AdminProfile | null> {
  const { data: profile, error } = await supabase
    .from('admin_user_directory_view')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !profile) {
    console.error('[useAuthStore] Error cargando perfil:', error?.message);
    return null;
  }

  return profile as AdminProfile;
}

const guard = createLoadGuard();
let pending: {
  userId: string;
  promise: Promise<AdminSessionOutcome<AdminProfile>>;
} | null = null;
let initPromise: Promise<void> | null = null;

const SIGNED_OUT_STATE = {
  user: null,
  profile: null,
  loading: false,
  initialized: true,
};

/** Único escritor del estado de autenticación del panel. */
export const useAuthStore = create<AuthState>((set, get) => {
  const onDenied = (reason: AdminAccessDenial) => {
    set(SIGNED_OUT_STATE);
    toast.error(adminAccessMessage(reason));
  };

  return {
    user: null,
    profile: null,
    loading: true,
    initialized: false,

    // Concurrent callers for the same user (login + SIGNED_IN event) share one
    // evaluation so neither is discarded as stale by the other.
    evaluateAccess: (user) => {
      if (pending?.userId === user.id) return pending.promise;

      const promise = resolveAdminSession(user.id, guard, {
        loadProfile: fetchAdminProfile,
        signOut: async () => {
          await supabase.auth.signOut();
        },
        clearCache: () => queryClient.clear(),
        onDenied,
      })
        .then((outcome) => {
          if (outcome.status === 'allowed') {
            set({
              user,
              profile: outcome.profile,
              loading: false,
              initialized: true,
            });
          }
          return outcome;
        })
        .finally(() => {
          if (pending?.promise === promise) pending = null;
        });
      pending = { userId: user.id, promise };
      return promise;
    },

    signOut: async () => {
      guard.begin();
      queryClient.clear();
      set(SIGNED_OUT_STATE);
      await supabase.auth.signOut();
    },

    initialize: () => {
      // Idempotente: una sola suscripción aunque se llame varias veces.
      initPromise ??= (async () => {
        supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'INITIAL_SESSION') return;

          if (event === 'SIGNED_OUT' || !session) {
            const hadUser = get().user !== null;
            guard.begin();
            queryClient.clear();
            set(SIGNED_OUT_STATE);
            if (hadUser)
              toast.warning('Sesión expirada. Redirigiendo al login...');
            return;
          }

          void get().evaluateAccess(session.user);
        });

        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (session?.user) await get().evaluateAccess(session.user);
        } catch (err) {
          console.error('[useAuthStore] Error de inicialización:', err);
          guard.begin();
          queryClient.clear();
        }
        set({ loading: false, initialized: true });
      })();
      return initPromise;
    },
  };
});
