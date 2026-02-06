// packages/types/src/index.ts

// Definimos los estados posibles de un producto
export type ProductStatus =
  | 'PENDING_VERIFICATION'
  | 'IN_REVIEW'
  | 'VERIFIED'
  | 'SOLD'
  | 'REJECTED'
  | 'RESERVED';

//Métodos de Pago
export interface PaymentMethod {
  id: string;
  user_id: string;
  stripe_payment_method_id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
  created_at: string;
}

// Definimos las categorías principales (extensible)
export type ProductCategory = 'GPU' | 'CPU' | 'Motherboard' | 'RAM' | 'Other';

// Definimos la estructura de una notificación
export type NotificationType = 'info' | 'success' | 'error' | 'warning';

// Estructura de la Dirección
export interface Address {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  street_line1: string;
  street_line2?: string | null;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  latitude?: number | null;
  longitude?: number | null;
  is_default: boolean;
}

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

export type ShippingCarrier = 'dhl' | 'estafeta' | 'paquetexpress' | 'fedex';

export interface ShippingOption {
  carrier: ShippingCarrier;
  service: string;
  price: number;
  estimated_days?: number;
}

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export interface Order {
  id: string;
  buyer_id: string;
  total_amount: number;
  stripe_payment_intent_id: string;
  status: OrderStatus;
  shipping_address: Address;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  seller_id: string;
  price_at_purchase: number;
  selected_carrier?: ShippingCarrier;
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

  // LOGÍSTICA
  shipping_cost: number;
  shipping_payer: 'buyer' | 'seller';
  package_preset: string;
  origin_zip: string;

  seller_id: string;
  views: number;
  aspect_ratio: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  specifications: Record<string, any>;
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
  stripe_customer_id?: string | null;
}
