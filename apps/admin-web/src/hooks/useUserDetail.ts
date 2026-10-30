import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/** Wrap a non-critical query so one failure doesn't crash the whole hook */
async function safeQuery<T>(
  promise: PromiseLike<{
    data: T;
    error: { message: string } | null;
    count?: number | null;
  }>,
  fallback?: unknown,
): Promise<{
  data: T;
  error: { message: string } | null;
  count?: number | null;
}> {
  try {
    const res = await promise;
    if (res.error) {
      console.warn('[useUserDetail] Query error:', res.error.message);
      return { data: (fallback ?? null) as T, error: null, count: null };
    }
    return res;
  } catch (err) {
    console.warn('[useUserDetail] Query threw:', err);
    return { data: (fallback ?? null) as T, error: null, count: null };
  }
}

export const useUserDetail = (userId: string) => {
  return useQuery({
    queryKey: ['user-detail', userId],
    queryFn: async () => {
      const results = await Promise.all([
        /* profile */ supabase
          .from('admin_user_directory_view')
          .select('*')
          .eq('id', userId)
          .single(),

        /* addresses */ safeQuery(
          supabase
            .from('addresses')
            .select('*')
            .eq('user_id', userId)
            .order('is_default', { ascending: false }),
          [],
        ),
        /* purchases */ safeQuery(
          supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('buyer_id', userId)
            .neq('status', 'cancelled')
            .neq('status', 'refunded'),
          [],
        ),
        /* products */ safeQuery(
          supabase
            .from('products')
            .select('*')
            .eq('seller_id', userId)
            .order('created_at', { ascending: false })
            .limit(20),
          [],
        ),
        /* notes */ safeQuery(
          supabase
            .from('admin_user_notes')
            .select('*, admin:profiles!admin_id(username)')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20),
          [],
        ),
        /* auditLogs */ safeQuery(
          supabase
            .from('admin_audit_logs')
            .select('*, admin:profiles(username)')
            .eq('target_id', userId)
            .order('created_at', { ascending: false })
            .limit(20),
          [],
        ),
        /* reports */ safeQuery(
          supabase
            .from('reports')
            .select(
              `
    *,
    reporter:profiles!reporter_id(username)
  `,
            )
            .eq('target_id', userId)
            .order('created_at', { ascending: false })
            .limit(20),
          [],
        ),
        /* reviews */ safeQuery(
          supabase
            .from('reviews')
            .select('*, reviewer:profiles!reviews_reviewer_id_fkey(username)')
            .eq('seller_id', userId)
            .order('created_at', { ascending: false }),
          [],
        ),
        /* cancelledSales */ safeQuery(
          supabase
            .from('order_items')
            .select('id, orders!inner(status)', {
              count: 'exact',
              head: true,
            })
            .eq('seller_id', userId)
            .eq('orders.status', 'cancelled'),
          [],
        ),
        /* cancelledPurchases */ safeQuery(
          supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('buyer_id', userId)
            .eq('status', 'cancelled'),
          [],
        ),
        /* purchasedItems */ safeQuery(
          supabase
            .from('order_items')
            .select(
              '*, product:products(name, images, price), orders!inner(status, buyer_id, created_at)',
            )
            .eq('orders.buyer_id', userId)
            .order('created_at', { ascending: false })
            .limit(20),
          [],
        ),
        /* volume */ safeQuery(
          supabase
            .from('order_items')
            .select('price_at_purchase, orders!inner(status)')
            .eq('seller_id', userId)
            .eq('orders.status', 'completed'),
          [],
        ),
        /* disputeDetails */ safeQuery(
          supabase
            .from('disputes')
            .select(
              `
        id,
        status,
        reason,
        resolution_type,
        created_at,
        order_id,
        seller_id,
        buyer_id
    `,
            )
            .or(`seller_id.eq.${userId},buyer_id.eq.${userId}`)
            .order('created_at', { ascending: false })
            .limit(10),
          [],
        ),
        /* profilesPrivate */ safeQuery(
          supabase
            .from('profiles_private')
            .select(
              'stripe_account_id, stripe_onboarding_status, phone_number, last_sign_in_at',
            )
            .eq('id', userId)
            .maybeSingle(),
          null,
        ),
        /* sellerTrustStats */ safeQuery(
          supabase
            .from('seller_trust_stats')
            .select('*')
            .eq('seller_id', userId)
            .maybeSingle(),
          null,
        ),
      ]);

      const profileRes = results[0];
      const addressRes = results[1];
      const purchasesRes = results[2];
      const productsRes = results[3];
      const notesRes = results[4];
      const logsRes = results[5];
      const reportsRes = results[6];
      const reviewsRes = results[7];
      const cancelledSalesRes = results[8];
      const cancelledPurchasesRes = results[9];
      const purchasedItemsRes = results[10];
      const volumeRes = results[11];
      const disputeDetailsRes = results[12];
      const profilesPrivateRes = results[13];
      const sellerTrustStatsRes = results[14];

      if (profileRes.error) throw profileRes.error;

      // --- LÓGICA DE CÁLCULO ---
      const disputes = disputeDetailsRes.data || [];
      const disputeStats = disputes.reduce(
        (acc: { won: number; lost: number; pending: number }, d) => {
          if (!d.resolution_type) {
            acc.pending++;
          } else {
            // Si el usuario es el vendedor y ganó el vendedor O es el comprador y ganó el comprador -> GANA
            const userWon =
              (d.seller_id === userId && d.resolution_type === 'seller') ||
              (d.buyer_id === userId && d.resolution_type === 'buyer');
            if (userWon) acc.won++;
            else acc.lost++;
          }
          return acc;
        },
        { won: 0, lost: 0, pending: 0 },
      );

      const totalVolume =
        volumeRes.data?.reduce(
          (acc: number, item) => acc + (item.price_at_purchase || 0),
          0,
        ) || 0;

      const reviews = reviewsRes.data || [];
      const avgRating =
        reviews.length > 0
          ? reviews.reduce((acc: number, r) => acc + r.rating, 0) /
            reviews.length
          : 0;

      return {
        profile: profileRes.data,
        addresses: addressRes.data || [],
        products: productsRes.data || [],
        purchasedItems: purchasedItemsRes.data || [],
        internalNotes: notesRes.data || [],
        auditLogs: logsRes.data || [],
        reportsCount: reportsRes.count || 0,
        reports: reportsRes.data || [],
        disputes: disputeDetailsRes.data || [],
        stripeAccountId: profilesPrivateRes.data?.stripe_account_id ?? null,
        stripeOnboardingStatus:
          profilesPrivateRes.data?.stripe_onboarding_status ?? null,
        phoneNumber: profilesPrivateRes.data?.phone_number ?? null,
        lastSignInAt: profilesPrivateRes.data?.last_sign_in_at ?? null,
        sellerTrustStats: sellerTrustStatsRes.data,
        reviews,
        avgRating,
        metrics: {
          sales: volumeRes.data?.length || 0,
          purchases: purchasesRes.count || 0,
          cancelledSales: cancelledSalesRes.count || 0,
          cancelledPurchases: cancelledPurchasesRes.count || 0,
          totalCancellations:
            (cancelledSalesRes.count || 0) + (cancelledPurchasesRes.count || 0),
          totalVolume,
          totalDisputes: disputes.length,
          wonDisputes: disputeStats.won,
          lostDisputes: disputeStats.lost,
          pendingDisputes: disputeStats.pending,
        },
      };
    },
    enabled: !!userId,
  });
};
