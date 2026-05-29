import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import type { User } from '@supabase/supabase-js';
import type { AdminProfile } from '../store/useAuthStore';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const setUser = useAuthStore((state) => state.setUser);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword(
        {
          email,
          password,
        },
      );

      if (authError) throw authError;

      const { data: profile, error: profileError } = await supabase
        .from('admin_user_directory_view')
        .select('*')
        .eq('id', data.user.id)
        .single();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        throw new Error(
          profileError
            ? `Error al validar perfil: ${profileError.message}`
            : 'Perfil de administrador no encontrado.',
        );
      }

      if (profile?.role !== 'admin') {
        await supabase.auth.signOut();
        throw new Error(
          `Acceso denegado: Tu rol actual es "${profile?.role ?? 'sin rol'}" y se requiere "admin".`,
        );
      }

      setUser(data.user as User, profile as AdminProfile);
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error inesperado al iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-night p-4">
      <div className="w-full max-w-md space-y-8 rounded-2xl bg-state-gray p-8 shadow-2xl border border-white/5">
        <div className="text-center">
          <h2 className="text-3xl  tracking-tight text-lion">SELENE</h2>
          <p className="mt-2 text-sm text-blue-light">
            Panel de Control Administrativo
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-platinum mb-1">
                Correo Electrónico
              </label>
              <input
                type="email"
                required
                disabled={loading}
                className="w-full rounded-lg bg-night border border-white/10 p-3 text-platinum focus:border-lion focus:outline-none focus:ring-2 focus:ring-lion/50 transition-colors disabled:opacity-50"
                placeholder="admin@selene.mx"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-platinum mb-1">
                Contraseña
              </label>
              <input
                type="password"
                required
                disabled={loading}
                className="w-full rounded-lg bg-night border border-white/10 p-3 text-platinum focus:border-lion focus:outline-none transition-colors disabled:opacity-50"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-fire/10 p-3 text-sm text-fire border border-fire/20">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="group relative flex w-full justify-center rounded-lg bg-lion py-3 px-4 text-sm font-semibold text-night hover:bg-lion/90 focus:outline-none focus:ring-2 focus:ring-lion/50 disabled:opacity-50 transition-all active:scale-95 cursor-pointer"
          >
            {loading ? 'Autenticando...' : 'Entrar al Sistema'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;
