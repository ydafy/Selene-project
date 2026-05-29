import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';

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

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  loading: true,
  initialized: false,
  setUser: (user, profile) => set({ user, profile, loading: false }),
  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, profile: null, loading: false });
  },
  initialize: async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        const { data: profile, error } = await supabase
          .from('admin_user_directory_view')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (error) {
          console.error('Error loading admin profile:', error.message);
          set({ user: session.user, profile: null, loading: false, initialized: true });
          return;
        }

        set({
          user: session.user,
          profile: profile as AdminProfile,
          loading: false,
          initialized: true,
        });
      } else {
        set({ user: null, profile: null, loading: false, initialized: true });
      }
    } catch (err) {
      console.error('Auth initialization failed:', err);
      set({ user: null, profile: null, loading: false, initialized: true });
    }
  },
}));
