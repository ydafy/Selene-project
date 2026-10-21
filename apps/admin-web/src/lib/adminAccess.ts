export type AdminAccessDenial = 'missing_profile' | 'not_admin' | 'inactive';

export type AdminAccess =
  { allowed: true } | { allowed: false; reason: AdminAccessDenial };

interface AccessProfile {
  role?: string | null;
  status?: string | null;
}

/**
 * Admin access requires the admin role AND an active account. The server
 * `is_admin()` rejects inactive admins, so the client must not show a dashboard
 * where every call would fail. Any unexpected status is denied.
 */
export const evaluateAdminAccess = (
  profile: AccessProfile | null | undefined,
): AdminAccess => {
  if (!profile) return { allowed: false, reason: 'missing_profile' };
  if (profile.role !== 'admin') return { allowed: false, reason: 'not_admin' };
  if (profile.status !== 'active')
    return { allowed: false, reason: 'inactive' };
  return { allowed: true };
};

export const adminAccessMessage = (reason: AdminAccessDenial): string => {
  switch (reason) {
    case 'missing_profile':
      return 'Perfil de administrador no encontrado.';
    case 'not_admin':
      return 'Acceso denegado: Esta cuenta no tiene permisos de administrador.';
    case 'inactive':
      return 'Acceso denegado: Esta cuenta está suspendida o inactiva.';
  }
};
