/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Database, Json } from './database.types';

// --- 1. UTILIDADES CORE ---
// Extrae el tipo de una fila de la tabla X
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
// Extrae el tipo de un Enum de la base de datos
export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T];

// --- 2. ALIAS DE TABLAS (Sincronización Automática) ---
export type Address = Tables<'addresses'>;
export type PaymentMethod = Tables<'payment_methods'>;
export type Notification = Tables<'notifications'>;
export type Wallet = Tables<'wallets'>;
export type WalletTransaction = Tables<'wallet_transactions'>;
export type PayoutRequest = Tables<'payout_requests'>;
export type SellerBankAccount = Tables<'seller_bank_accounts'>;
export type Profile = Tables<'profiles'>;
export type Product = Tables<'products'>;
export type Order = Tables<'orders'>;
export type Dispute = Tables<'disputes'>;
export type Shipment = Tables<'shipments'>;

// --- 3. ENUMS (Sincronizados con Postgres) ---
// Si cambias el Enum en la DB y corres la CLI, estos se actualizan solos

export type OrderStatus = Enums<'order_status_enum'>;
export type AccountStatus = Enums<'account_status'>;

export type ProductStatus =
  | 'PENDING_VERIFICATION'
  | 'IN_REVIEW'
  | 'VERIFIED'
  | 'SOLD'
  | 'REJECTED'
  | 'HIDDEN'
  | 'RESERVED';

export type UserRole = 'user' | 'admin' | 'moderator';
export type ShippingPayer = 'buyer' | 'seller';

export type ProductCategory = 'GPU' | 'CPU' | 'Motherboard' | 'RAM';

export interface VerificationData {
  proof_physical: string;
  proof_performance?: string;
  benchmark_score?: number;
  submitted_at: string;
}

export interface BuyerEvidence {
  images: string[];
  video_url?: string | null;
  tech_checklist?: Record<string, boolean>;
  return_images?: string[];
}

export interface SellerEvidence {
  images: string[];
  video_url?: string | null;
}

// --- 5. TIPOS DE UI Y LOGÍSTICA ---

export type ShippingCarrier = 'dhl' | 'estafeta' | 'paquetexpress' | 'fedex';

export interface ShippingOption {
  carrier: ShippingCarrier;
  service: string;
  price: number;
  estimated_days?: number;
}

export interface EnrichedProduct extends Omit<Product, 'specifications'> {
  specifications: Record<string, any>;
  category: ProductCategory;
}

export interface ProductWithSeller extends EnrichedProduct {
  seller: Profile | null;
}

/**
 * Envío Enriquecido para la UI (Contenedor Logístico Hijo).
 * Maneja el tracking, timestepper, acciones y disputas aisladas por vendedor.
 */
export interface EnrichedShipment extends Shipment {
  // Joins aislados por paquete
  items: (Tables<'order_items'> & { product: Product })[];
  dispute?:
    | (Dispute & {
        buyer_evidence: BuyerEvidence;
        seller_evidence: SellerEvidence;
      })
    | null;

  // Helpers de UI del paquete
  isBuyer: boolean;
  isSeller: boolean;

  // Permisos estrictos calculados por paquete (basados en shipment.status)
  permissions: {
    canCancel: boolean;
    canReport: boolean;
    canConfirmDelivery: boolean;
    canPayReturn: boolean;
    canUploadReturnEvidence: boolean;
    canGenerateReturnLabel: boolean;
    showInstructions: boolean;
    showUnboxingWarning: boolean;
    showOriginalTracking: boolean;
    showReturnTracking: boolean;
    showDisputeBanner: boolean;
    showReturnBanner: boolean;
    showSellerDeliveredBanner: boolean;
    canReview: boolean;
  };
}

/**
 * Orden Enriquecida para la UI (Contenedor Financiero Padre).
 * Vincula el pago global con sus múltiples envíos fraccionados (shipments).
 * NOTA: origin_address, tracking_number, label_url, shipping_evidence, last_tracked_at
 * se migraron a shipments. EnrichedOrder ya no los tiene.
 */
export interface EnrichedOrder extends Omit<
  Order,
  'shipping_address'
> {
  shipping_address: Address;

  // Colección de paquetes divididos por vendedor
  shipments: EnrichedShipment[];

  // Helpers de UI globales
  isBuyer: boolean;
  isSeller: boolean;
  visualStatus: OrderStatus;
}

// --- 6. INTERFACES ENRIQUECIDAS PARA ADMIN (Phase 2) ---

export interface PendingProduct extends Omit<Product, 'verification_data'> {
  seller: Profile | null;
  seller_stats: {
    verified: number;
    rejected: number;
    sold: number;
    ratio: number;
  };
  verification_data: VerificationData;
  internal_notes: Array<{
    content: string;
    created_at: string;
    admin: { username: string } | null;
  }>;
}

export interface AdminUser {
  id: string | null;
  username: string | null;
  email: string | null;
  role: string | null;
  status: AccountStatus | null;
  avatar_url: string | null;
  available_balance: number | null;
  pending_balance: number | null;
  sold_count: number | null;
  verified_count: number | null;
  processed_count: number | null;
  total_listings: number | null;
  phone_number: string | null;
  last_sign_in_at: string | null;
  created_at: string | null;
  is_verified_seller: boolean | null;
}

export interface DisputeSummary {
  dispute_id: string | null;
  dispute_date: string | null;
  order_id: string | null;
  total_amount: number | null;
  buyer_username: string | null;
  seller_username: string | null;
  dispute_description_preview: string | null;
  dispute_status: Enums<'dispute_status'> | null;
}

export interface OrderItemWithProduct extends Tables<'order_items'> {
  product: Pick<Product, 'name' | 'images' | 'price'>;
  orders: Pick<Order, 'status'> | null;
}

export interface AdminAuditLog {
  id: string;
  action_type: string;
  target_id: string | null;
  admin_id: string | null;
  details: Json | null;
  created_at: string | null;
  admin: { username: string | null } | null;
}

// Exportamos todo lo de database.types por si acaso
export * from './database.types';
