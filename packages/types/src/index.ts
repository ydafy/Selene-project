// packages/types/src/index.ts

// Definimos los estados posibles de un producto
export type ProductStatus =
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'SOLD'
  | 'REJECTED';

// Definimos las categorías principales (extensible)
export type ProductCategory = 'GPU' | 'CPU' | 'Motherboard' | 'RAM' | 'Other';

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
  images: string[]; // Array de URLs
  status: ProductStatus;
  seller_id: string;
  views: number;
  // JSONB en la base de datos se traduce a un objeto flexible en TS.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  specifications: Record<string, any>;
}

// También podemos exportar un tipo para el perfil de usuario si lo necesitamos
export interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
  created_at: string;
}
