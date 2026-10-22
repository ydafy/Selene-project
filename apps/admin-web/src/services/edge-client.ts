import { supabase } from '../lib/supabase';
import type { EdgeFunctionRegistry } from '@selene/types';

/**
 * Invoca una Edge Function de Supabase con contrato tipado y manejo de errores unificado.
 *
 * - Tipado estricto: `K` se infiere del registry, payload y response son type-safe.
 * - Error handling unificado: parsea `error.context.json()`, chequea flags `success`.
 * - Sin strings mágicos en los hooks.
 */
export async function invokeEdge<K extends keyof EdgeFunctionRegistry>(
  name: K,
  body: EdgeFunctionRegistry[K]['payload'],
): Promise<EdgeFunctionRegistry[K]['response']> {
  const { data, error } = await supabase.functions.invoke(name, { body });

  // 1. Error de red / HTTP → intentamos extraer mensaje del body
  if (error) {
    const errorBody = await error.context.json().catch(() => null);
    throw new Error(errorBody?.error || errorBody?.message || error.message);
  }

  // 2. Validación de negocio: si la respuesta tiene flag `success` en false
  const result = data as EdgeFunctionRegistry[K]['response'];
  if (
    result &&
    typeof result === 'object' &&
    'success' in result &&
    !(result as { success: boolean }).success
  ) {
    throw new Error(
      (result as { error_message?: string }).error_message ||
        'Operación fallida en el servidor',
    );
  }

  return result;
}

/** A failed Edge Function call; `code` is the stable `{ error }` code of the response, when readable. */
export class EdgeFunctionError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.code = code;
    this.name = 'EdgeFunctionError';
  }
}

/**
 * Invoca una Edge Function fuera del registry tipado (GET o POST) y devuelve el
 * JSON sin interpretar: quien llama debe validarlo en el borde. Las funciones
 * de reembolsos responden `{ error: CODE }` con HTTP no-2xx, sin flag `success`.
 */
export async function invokeEdgeJson(
  name: string,
  options: { method: 'GET' } | { method: 'POST'; body: Record<string, unknown> },
): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(name, options);
  if (error) {
    const body = await Promise.resolve()
      .then(() => (error.context as Response).json() as Promise<{ error?: unknown } | null>)
      .catch(() => null);
    throw new EdgeFunctionError(error.message, typeof body?.error === 'string' ? body.error : null);
  }
  return data;
}
