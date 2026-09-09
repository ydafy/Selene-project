/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Database, Json } from './database.types';

// --- 1. UTILIDADES CORE ---
// Extrae el tipo de una fila de la tabla X
export type Tables<
  T extends keyof (Database['public']['Tables'] & Database['public']['Views']),
> = (Database['public']['Tables'] & Database['public']['Views'])[T]['Row'];
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
export type ShipmentTrackingEvent = Tables<'shipment_tracking_events'>;
export type ConnectPayoutRun = Tables<'connect_payout_runs'>;
export type ConnectPayoutRunShipment = Tables<'connect_payout_run_shipments'>;
export type ConnectPayoutReleaseQueueRow =
  Tables<'admin_connect_payout_release_view'>;

// --- 3. ENUMS (Sincronizados con Postgres) ---
// Si cambias el Enum en la DB y corres la CLI, estos se actualizan solos

export type OrderStatus = Enums<'order_status_enum'>;
export type AccountStatus = Enums<'account_status'>;
export type PayoutStatus = Enums<'payout_status'>;
export type StripeOnboardingStatus = Enums<'stripe_onboarding_status'>;

export type ProductStatus = Enums<'product_status_enum'>;

export type UserRole = 'user' | 'admin' | 'moderator';
export type ShippingPayer = 'buyer' | 'seller';

export type ConnectPayoutRunStatus =
  | 'pending_reconciliation'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'reconciliation_needed';

export interface ConnectPayoutReleaseRequest {
  sellerId: string;
  shipmentIds: string[];
  idempotencyKey: string;
}

export type ReleaseConnectPayoutResponse =
  | {
      success: true;
      runId: string;
      stripePayoutId?: string;
      /**
       * Stripe Transfer ID created per shipment when the release moves platform
       * funds to the seller Connect account under the order-level transfer_group.
       * Absent for the legacy per-seller destination-charge flow which had no
       * platform->seller Transfer step.
       */
      stripeTransferId?: string;
      status: ConnectPayoutRunStatus;
      amount: number;
    }
  | {
      success: false;
      error: string;
      code?: 'stripe_balance_insufficient';
      retryable?: boolean;
      required_amount_cents?: number;
      available_amount_cents?: number;
      currency?: 'mxn';
    };

export type ConnectPayoutReleaseQueueRequest = { search?: string };

export type ConnectPayoutReleaseQueueResponse = {
  success: boolean;
  rows?: ConnectPayoutReleaseQueueRow[];
  error?: string;
};

export type ConnectPaymentErrorCode =
  | 'RESERVATION_EXPIRED'
  | 'RESERVATION_FAILED'
  | 'PI_CREATION_FAILED';

/**
 * Legacy per-seller destination-charge client secret shape. Retained for the
 * legacy per-seller flow until the frontend Phase-6 migration retires it.
 * Single-modal checkout uses `CreateConnectPaymentResponse` below instead.
 */
export interface ConnectPaymentIntentClientSecret {
  sellerId: string;
  shipmentId: string;
  clientSecret: string;
  amount: number;
  descriptor: string;
}

/**
 * Single-modal multi-seller checkout: one platform-account PaymentIntent
 * returned to a single Stripe PaymentSheet, with an order-level transfer_group
 * used to group per-shipment platform->seller Transfers on manual release.
 */
export interface CreateConnectPaymentResponse {
  orderId: string;
  clientSecret: string;
  customer: string;
  ephemeralKey: string;
  amount: number;
  transferGroup: string;
}

export interface CreateDisputeRequest {
  orderId: string;
  shipmentId: string;
  reason: string;
  description: string;
  evidence: {
    images: string[];
    tech_checklist: Record<string, boolean>;
    video_url: string | null;
  };
}

export interface CreateConnectPaymentRequestItem {
  productId: string;
  quantity: 1;
}

// --- EDGE FUNCTION REGISTRY (Contratos tipados para invokeEdge) ---
export interface EdgeFunctionRegistry {
  'resolve-dispute': {
    payload: {
      disputeId: string;
      verdict: 'seller' | 'buyer' | 'insurance';
      adminNote: string;
    };
    response: { success: boolean; error?: string };
  };
  'resolve-dispute-refund': {
    payload: { orderId: string; disputeId: string };
    response: { success: boolean; error?: string };
  };
  'create-dispute': {
    payload: CreateDisputeRequest;
    response: { success: boolean; error?: string };
  };
  'cancel-order': {
    payload: { orderId: string; shipmentId: string; reason?: string };
    response: { success: boolean; error?: string };
  };
  'confirm-shipment-delivery': {
    payload: {
      orderId: string;
      shipmentId: string;
      idempotencyKey: string;
    };
    response:
      | {
          success: true;
          shipmentId: string;
          status: 'completed';
          completionSource: 'buyer' | 'auto';
          idempotent: boolean;
        }
      | { success: false; error: string };
  };
  'generate-shipping-label': {
    payload: {
      shipmentId: string;
      originAddressId: string;
      shippingEvidence: { images: string[] };
    };
    response: { success: boolean; trackingNumber: string; labelUrl: string };
  };
  'generate-return-label': {
    payload: { disputeId: string };
    response: {
      success: boolean;
      labelUrl?: string;
      trackingNumber?: string;
      error?: string;
    };
  };
  'create-return-intent': {
    payload: { disputeId: string; idempotencyKey: string };
    response: {
      clientSecret: string;
      customer: string;
      ephemeralKey: string;
    };
  };
  'delete-account': {
    payload: Record<string, never>;
    response:
      { success: true } | { error: string; blocked_reason?: string } | null;
  };
  'manage-payment-methods': {
    payload:
      | { action: 'list_payment_methods' }
      | { action: 'get_setup_config' }
      | { action: 'delete_payment_method'; paymentMethodId: string };
    response: {
      methods?: PaymentMethod[];
      clientSecret?: string;
      customer?: string;
      ephemeralKey?: string;
    };
  };
  'create-payment-intent': {
    payload: {
      productIds: string[];
      addressId: string;
      idempotencyKey: string;
    };
    response: {
      clientSecret: string;
      ephemeralKey: string;
      customer: string;
      amount: number;
    };
  };
  'create-connect-account': {
    payload: { refreshUrl?: string; returnUrl?: string };
    response: { url: string; accountId: string };
  };
  'refresh-connect-account-status': {
    payload: { sellerId?: string; force?: boolean };
    response: {
      status: StripeOnboardingStatus;
      hasStripeAccount: boolean;
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
      refreshedAt: string;
      cached: boolean;
      error?: 'STRIPE_REFRESH_FAILED';
    };
  };
  'create-connect-payment': {
    payload: {
      items: CreateConnectPaymentRequestItem[];
      addressId: string;
      idempotencyKey?: string;
    };
    response: CreateConnectPaymentResponse;
  };
  'get-connect-payout-release-queue': {
    payload: ConnectPayoutReleaseQueueRequest;
    response: ConnectPayoutReleaseQueueResponse;
  };
  'release-connect-payout': {
    payload: ConnectPayoutReleaseRequest;
    response: ReleaseConnectPayoutResponse;
  };
  'get-shipping-quote': {
    payload: {
      originZip: string;
      packageId: string;
      price: number;
      destinationZip?: string;
    };
    response: { rates: ShippingOption[] };
  };
  'get-shipping-quote-seller': {
    payload: { originZip: string; packageId: string };
    response: { price: number };
  };
}

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
  seller: Profile | null;
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
export interface EnrichedOrder extends Omit<Order, 'shipping_address'> {
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
