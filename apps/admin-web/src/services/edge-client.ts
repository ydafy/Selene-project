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
