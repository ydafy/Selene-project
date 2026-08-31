/**
 * @file src/constants/auditActions.ts
 * @description Fuente Única de la Verdad (SSOT) para las acciones de auditoría en Selene.
 */

import {
  CheckCircle2,
  XCircle,
  RotateCcw,
  Package,
  BadgeCheck,
  UserCog,
  Activity,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

export type AdminAuditActionType =
  | 'PRODUCT_APPROVE'
  | 'PRODUCT_REJECT'
  | 'PRODUCT_SOFT_DELETE'
  | 'PRODUCT_RESTORE'
  | 'DISPUTE_WAITING_RETURN'
  | 'DISPUTE_RESOLVE_SELLER'
  | 'DISPUTE_RESOLVE_BUYER'
  | 'DISPUTE_RESOLVE_INSURANCE'
  | 'USER_VERIFICATION_TOGGLE'
  | 'USER_STATUS_UPDATE'
  | string;

export interface ActionMeta {
  icon: LucideIcon;
  color: string;
  verb: string;
}

export const ADMIN_ACTION_CONFIG: Record<string, ActionMeta> = {
  // ── Moderación de Productos ──
  PRODUCT_APPROVE: {
    icon: CheckCircle2,
    color: 'text-forest',
    verb: 'aprobó la publicación',
  },
  PRODUCT_REJECT: {
    icon: XCircle,
    color: 'text-fire',
    verb: 'rechazó el producto',
  },
  PRODUCT_SOFT_DELETE: {
    icon: XCircle,
    color: 'text-fire',
    verb: 'eliminó la publicación',
  },
  PRODUCT_RESTORE: {
    icon: RotateCcw,
    color: 'text-lion',
    verb: 'restauró el producto',
  },

  // ── Arbitraje de Disputas ──
  DISPUTE_WAITING_RETURN: {
    icon: Package,
    color: 'text-lion',
    verb: 'solicitó la devolución del paquete en',
  },
  DISPUTE_RESOLVE_SELLER: {
    icon: CheckCircle2,
    color: 'text-forest',
    verb: 'resolvió la disputa a favor del vendedor en',
  },
  DISPUTE_RESOLVE_BUYER: {
    icon: RotateCcw,
    color: 'text-blue-light',
    verb: 'autorizó el reembolso al comprador en',
  },
  DISPUTE_RESOLVE_INSURANCE: {
    icon: ShieldCheck,
    color: 'text-purple-400',
    verb: 'cubrió la disputa con Seguro Selene en',
  },

  // ── Gestión de Usuarios ──
  USER_VERIFICATION_TOGGLE: {
    icon: BadgeCheck,
    color: 'text-blue-light',
    verb: 'modificó el Sello de Verificación de',
  },
  USER_STATUS_UPDATE: {
    icon: UserCog,
    color: 'text-lion',
    verb: 'actualizó el estado de la cuenta de',
  },
};

export const DEFAULT_ACTION_META: ActionMeta = {
  icon: Activity,
  color: 'text-blue-light',
  verb: 'procesó una acción en',
};

export function getActionMeta(actionType: string): ActionMeta {
  return ADMIN_ACTION_CONFIG[actionType] || DEFAULT_ACTION_META;
}
