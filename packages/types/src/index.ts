// packages/types/src/index.ts

// Definimos los estados posibles de un producto
export type ProductStatus =
  | 'PENDING_VERIFICATION'
  | 'IN_REVIEW'
  | 'VERIFIED'
  | 'SOLD'
  | 'REJECTED';

// Definimos las categorías principales (extensible)
export type ProductCategory = 'GPU' | 'CPU' | 'Motherboard' | 'RAM' | 'Other';

// Definimos la estructura de una notificación
export type NotificationType = 'info' | 'success' | 'error' | 'warning';

// Estructura de la Notificación
export interface Notification {
  id: string;
  created_at: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  action_path?: string;
}

/**
 * Estructura estricta para los datos de verificación.
 * Esto se guarda como JSONB en la base de datos.
 */
export interface VerificationData {
  proof_physical: string; // URL/Path de la foto con papelito
  proof_performance?: string; // URL/Path de la foto del benchmark (Opcional para RAM/Case)
  benchmark_score?: number; // Puntaje numérico (Opcional)
  submitted_at: string; // Fecha ISO de envío
}

// Definimos la interfaz principal del Producto
// Esto debe coincidir con las columnas de tu base de datos Supabase.
export interface Product {
  id: string;
  created_at: string;
  name: string;
  description: string;
  price: number;
  category: ProductCategory;
  condition: string;
  usage: string;
  images: string[];
  status: ProductStatus;
  rejection_reason?: string | null;
  seller_id: string;
  views: number;
  aspect_ratio: number;

  // JSONB en la base de datos se traduce a un objeto flexible en TS.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  specifications: Record<string, any>;

  //Datos de verificación (Puede ser null si no ha subido nada)
  verification_data?: VerificationData | null;
}

// También podemos exportar un tipo para el perfil de usuario si lo necesitamos
export type UserRole = 'user' | 'admin' | 'moderator';
export interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
  created_at: string;
  role: UserRole;
}
