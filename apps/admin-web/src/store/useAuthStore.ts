import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';
import { toast } from 'sonner';

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
  setUser: (user: User | null, profile: AdminProfile | null) => void;
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
}

// Función auxiliar para cargar perfil y validar rol de administrador
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

  // Guardia de Seguridad: Expulsamos a usuarios que no sean administradores
  if (profile.role !== 'admin') {
    console.warn('[useAuthStore] Acceso no autorizado: El usuario no es admin');
    toast.error(
      'Acceso denegado: Esta cuenta no tiene permisos de administrador.',
    );
    await supabase.auth.signOut();
    return null;
  }

  return profile as AdminProfile;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  initialized: false,

  setUser: (user, profile) => set({ user, profile, loading: false }),

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, profile: null, loading: false, initialized: true });
  },

  initialize: async () => {
    // Evitamos duplicar listeners si ya se inicializó
    if (get().initialized) return;

    try {
      // 1. Snapshot Inicial de la Sesión
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        const profile = await fetchAdminProfile(session.user.id);
        set({
          user: profile ? session.user : null,
          profile,
          loading: false,
          initialized: true,
        });
      } else {
        set({ user: null, profile: null, loading: false, initialized: true });
      }

      // 2. Listener Reactivo en Tiempo Real (Maneja refrescos de tokens de 60m y cierres de sesión)
      supabase.auth.onAuthStateChange(async (event, currentSession) => {
        if (event === 'SIGNED_OUT' || !currentSession) {
          set({ user: null, profile: null, loading: false, initialized: true });
          return;
        }

        if (
          event === 'TOKEN_REFRESHED' ||
          event === 'SIGNED_IN' ||
          event === 'USER_UPDATED'
        ) {
          const profile = await fetchAdminProfile(currentSession.user.id);
          set({
            user: profile ? currentSession.user : null,
            profile,
            loading: false,
            initialized: true,
          });
        }
      });
    } catch (err) {
      console.error('[useAuthStore] Error de inicialización:', err);
      set({ user: null, profile: null, loading: false, initialized: true });
    }
  },
}));
