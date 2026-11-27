/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Database, Json } from './database.types.ts';

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
export type Notification = Tables<'notifications'>;
export type Profile = Tables<'profiles'>;
export type Product = Tables<'products'>;
/**
 * A listing as buyers read it, through the `products_public` allow-list view.
 * View rows are typed fully nullable; hooks cast them to this at the boundary.
 */
export type PublicProduct = Pick<
  Product,
  | 'id'
  | 'seller_id'
  | 'name'
  | 'description'
  | 'price_cents'
  | 'category'
  | 'condition'
  | 'usage'
  | 'images'
  | 'specifications'
  | 'aspect_ratio'
  | 'status'
  | 'views'
  | 'created_at'
  | 'fts'
>;
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

export type OrderStatus = Enums<'order_status'>;
export type AccountStatus = Enums<'account_status'>;
export type StripeOnboardingStatus = Enums<'stripe_onboarding_status'>;

export type ProductStatus = Enums<'product_status'>;

export type UserRole = 'user' | 'admin' | 'moderator';
export type ShippingPayer = 'buyer' | 'seller';

export type ConnectPayoutRunStatus =
  | 'pending_reconciliation'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'reconciliation_needed';

export type ConnectPayoutReleaseRequest =
  | {
      sellerId: string;
      shipmentIds: string[];
      idempotencyKey: string;
      retryRunId?: never;
    }
  | {
      retryRunId: string;
      sellerId?: never;
      shipmentIds?: never;
      idempotencyKey?: never;
    };

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

/** `overdue`: run-less shipments held 30 days or more because the seller cannot be paid (#549). */
export type ConnectPayoutQueueBucket =
  'ready' | 'overdue' | 'processing' | 'action-required' | 'history';
export type ConnectPayoutQueueScope = 'page' | 'selection';
export type ConnectPayoutQueueCounts = Record<ConnectPayoutQueueBucket, number>;

export type ConnectPayoutReleaseQueueRequest = {
  search?: string;
  bucket?: ConnectPayoutQueueBucket;
  page?: number;
  scope?: ConnectPayoutQueueScope;
};

export type ConnectPayoutReleaseQueueResponse = {
  success: boolean;
  rows?: ConnectPayoutReleaseQueueRow[];
  error?: string;
  counts?: ConnectPayoutQueueCounts;
  bucket?: ConnectPayoutQueueBucket;
  scope?: ConnectPayoutQueueScope;
  page?: number;
  pageSize?: number;
  totalGroups?: number;
  totalPages?: number;
  selectedGroupCount?: number;
  selectionComplete?: boolean;
};

/** Admin keeps an overdue held payout on hold with a note (#549). */
export type RecordPayoutHoldNoteRequest = {
  shipment_id: string;
  /** 1 to 1000 characters after trimming. */
  note: string;
};

export type RecordPayoutHoldNoteResponse =
  | {
      id: string;
      shipment_id: string;
      note: string;
      noted_at: string;
      noted_by: string;
    }
  | {
      error:
        | 'METHOD_NOT_ALLOWED'
        | 'AUTH_REQUIRED'
        | 'ADMIN_ONLY'
        | 'INVALID_SHIPMENT_ID'
        | 'INVALID_HOLD_NOTE'
        | 'SHIPMENT_NOT_FOUND'
        | 'PAYOUT_NOT_OVERDUE'
        | 'INTERNAL_ERROR';
    };

/**
 * Admin refund of an overdue held payout whose seller Stripe rejected (#549). Only the shipment
 * is sent: the server computes the amount. `pending` means Stripe has not settled the refund yet;
 * the `refund.updated` webhook completes it.
 */
export type RefundOverduePayoutRequest = {
  shipment_id: string;
};

export type RefundOverduePayoutResponse =
  | {
      status: 'refunded' | 'pending';
      shipment_id: string;
      refund_id: string;
      amount_cents: number;
    }
  | {
      error:
        | 'METHOD_NOT_ALLOWED'
        | 'AUTH_REQUIRED'
        | 'ADMIN_ONLY'
        | 'INVALID_SHIPMENT_ID'
        | 'SHIPMENT_NOT_FOUND'
        | 'SHIPMENT_NOT_COMPLETED'
        | 'SHIPMENT_ALREADY_REFUNDED'
        | 'SHIPMENT_FUNDS_ALREADY_RELEASED'
        | 'SHIPMENT_TRANSFER_OPERATION_ACTIVE'
        | 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE'
        | 'PAYOUT_NOT_OVERDUE'
        | 'PAYOUT_RUN_NOT_PARKED'
        | 'SELLER_ACCOUNT_NOT_REJECTED'
        | 'PAYMENT_METHOD_NOT_REFUNDABLE'
        | 'REFUND_AMOUNT_EXCEEDS_CAP'
        | 'REFUND_IN_PROGRESS'
        | 'REFUND_RECOVERY_REQUIRED'
        | 'REFUND_UNCONFIRMED'
        | 'REFUND_FAILED'
        | 'REFUND_AMOUNT_INVALID'
        | 'REFUND_RECORD_FAILED'
        | 'REFUND_ESCALATION_FAILED'
        | 'REFUND_COMPLETION_FAILED'
        | 'STRIPE_REQUEST_FAILED'
        | 'INTERNAL_ERROR';
    };

export type ConnectPaymentErrorCode =
  'RESERVATION_EXPIRED' | 'RESERVATION_FAILED' | 'PI_CREATION_FAILED';

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
  /** CustomerSession for PaymentSheet: it shows, saves and removes the buyer's saved cards. */
  customerSessionClientSecret: string;
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
      customerSessionClientSecret: string;
    };
  };
  'delete-account': {
    payload: Record<string, never>;
    response:
      { success: true } | { error: string; blocked_reason?: string } | null;
  };
  'manage-payment-methods': {
    // Stripe CustomerSheet owns the saved cards; Selene keeps no copy.
    payload:
      { action: 'create_customer_session' } | { action: 'create_setup_intent' };
    response:
      | { customerId: string; customerSessionClientSecret: string }
      | { setupIntentClientSecret: string };
  };
  'create-connect-account': {
    payload: { refreshUrl?: string; returnUrl?: string; source?: 'listing' };
    response: { url: string; accountId: string };
  };
  'resolve-shipment-tracking-url': {
    payload: { shipmentId: string };
    response: { url: string | null };
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
  'record-payout-hold-note': {
    payload: RecordPayoutHoldNoteRequest;
    response: RecordPayoutHoldNoteResponse;
  };
  'refund-overdue-payout': {
    payload: RefundOverduePayoutRequest;
    response: RefundOverduePayoutResponse;
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
}

export type ProductCategory = 'GPU' | 'CPU' | 'Motherboard' | 'RAM';

export type VerificationEvidenceKind = Enums<'verification_evidence_kind'>;

/** One proof of a verification attempt, as `admin_product_queue_view.evidence` lists it. */
export interface VerificationEvidence {
  kind: VerificationEvidenceKind;
  storage_path: string;
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

/** `shipments.shipping_evidence`: the seller's packing photos (evidence bucket paths). */
export interface ShippingEvidence {
  images: string[];
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

/** A listing in the verification queue: its open attempt from `admin_product_queue_view`. */
export interface PendingProduct extends Omit<
  Tables<'admin_product_queue_view'>,
  'evidence'
> {
  seller: Profile | null;
  seller_stats: {
    verified: number;
    rejected: number;
    sold: number;
    ratio: number;
  };
  evidence: VerificationEvidence[];
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
  total_amount_cents: number | null;
  buyer_username: string | null;
  seller_username: string | null;
  dispute_description_preview: string | null;
  dispute_status: Enums<'dispute_status'> | null;
}

export interface OrderItemWithProduct extends Tables<'order_items'> {
  product: Pick<Product, 'name' | 'images' | 'price_cents'>;
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
export type * from './database.types.ts';
