import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

import {
  GetSellerOnboardingError,
  getSellerOnboardingErrorStatus,
  resolveSellerOnboardingResponse,
  type SellerOnboardingResponse,
} from './get-seller-onboarding.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: SellerOnboardingResponse, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!serviceRoleKey || !supabaseUrl) {
      throw new Error('MISSING_SERVER_CONFIG');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new Error('AUTH_REQUIRED');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
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
});
