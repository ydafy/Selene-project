import type { SupabaseClient } from '../_shared/supabase-js.ts';

import {
  GetSellerOnboardingError,
  getSellerOnboardingErrorStatus,
  resolveSellerOnboardingResponse,
  type SellerOnboardingResponse,
} from './get-seller-onboarding.ts';

export type SupabaseAdminClient = SupabaseClient;

export interface GetSellerOnboardingDependencies {
  getEnv: (name: string) => string | undefined;
  readSupabaseSecretKey: () => string | undefined;
  // Called once per request, after the Bearer token is present.
  createSupabaseAdmin: (
    supabaseUrl: string,
    supabaseSecretKey: string,
  ) => SupabaseAdminClient;
}

const jsonResponse = (body: SellerOnboardingResponse, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export function createGetSellerOnboardingHandler(
  deps: GetSellerOnboardingDependencies,
) {
  return async (req: Request): Promise<Response> => {
    try {
      const supabaseSecretKey = deps.readSupabaseSecretKey();
      const supabaseUrl = deps.getEnv('SUPABASE_URL');
      if (!supabaseSecretKey || !supabaseUrl) {
        throw new Error('MISSING_SERVER_CONFIG');
      }

      const authHeader = req.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        throw new Error('AUTH_REQUIRED');
      }

      const supabaseAdmin = deps.createSupabaseAdmin(
        supabaseUrl,
        supabaseSecretKey,
      );
      const token = authHeader.slice('Bearer '.length);
      const {
        data: { user },
        error: authError,
      } = await supabaseAdmin.auth.getUser(token);
      if (authError || !user) throw new Error('AUTH_REQUIRED');

      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles_private')
        .select('role, stripe_account_id, stripe_onboarding_status')
        .eq('id', user.id)
        .maybeSingle();

      const response = await resolveSellerOnboardingResponse({
        profile,
        profileError,
        loadAdminRows: async () => {
          const { data, error } = await supabaseAdmin
            .from('admin_seller_onboarding_view')
            .select('*')
            .order('created_at', { ascending: false });

          return { data, error };
        },
      });

      return jsonResponse(response, 200);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        error instanceof GetSellerOnboardingError
          ? error.status
          : getSellerOnboardingErrorStatus(message);

      return jsonResponse({ success: false, error: message }, status);
    }
  };
}
