import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/** Wrap a non-critical query so one failure doesn't crash the whole hook */
async function safeQuery(
  promise: PromiseLike<any>,
  fallback?: any,
): Promise<{ data: any; error: null; count?: number | null }> {
  try {
    const res = await promise;
    if (res.error) {
      console.warn('[useUserDetail] Query error:', res.error.message);
      return { data: fallback ?? null, error: null, count: null };
    }
    return res;
  } catch (err) {
    console.warn('[useUserDetail] Query threw:', err);
    return { data: fallback ?? null, error: null, count: null };
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

        /* bank */ safeQuery(
          supabase
            .from('seller_bank_accounts')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle(),
          null,
        ),
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
        /* payouts */ safeQuery(
          supabase
            .from('payout_requests')
            .select('*')
            .eq('user_id', userId)
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
        /* transactions */ safeQuery(
          supabase
            .from('wallet_transactions')
            .select(
              `
    *,
    wallet:wallets!inner(user_id)
  `,
            )
            .eq('wallet.user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20),
          [],
        ),
        /* profilesPrivate */ safeQuery(
          supabase
            .from('profiles_private')
            .select('stripe_account_id, stripe_onboarding_status, phone_number, last_sign_in_at')
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
      const bankRes = results[1];
      const addressRes = results[2];
      const purchasesRes = results[3];
      const productsRes = results[4];
      const notesRes = results[5];
      const logsRes = results[6];
      const payoutsRes = results[7];
      const reportsRes = results[8];
      const reviewsRes = results[9];
      const cancelledSalesRes = results[10];
      const cancelledPurchasesRes = results[11];
      const purchasedItemsRes = results[12];
      const volumeRes = results[13];
      const disputeDetailsRes = results[14];
      const transactionsRes = results[15];
      const profilesPrivateRes = results[16];
      const sellerTrustStatsRes = results[17];

      if (profileRes.error) throw profileRes.error;

      // --- LÓGICA DE CÁLCULO ---
      const disputes: any[] = disputeDetailsRes.data || [];
      const disputeStats = disputes.reduce(
        (acc: { won: number; lost: number; pending: number }, d: any) => {
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
        (volumeRes.data as any[])?.reduce(
          (acc: number, item: any) => acc + (item.price_at_purchase || 0),
          0,
        ) || 0;

      const reviews: any[] = reviewsRes.data || [];
      const avgRating =
        reviews.length > 0
          ? reviews.reduce((acc: number, r: any) => acc + r.rating, 0) /
            reviews.length
          : 0;

      return {
        profile: profileRes.data,
        bank: bankRes.data,
        addresses: addressRes.data || [],
        products: productsRes.data || [],
        purchasedItems: purchasedItemsRes.data || [],
        internalNotes: notesRes.data || [],
        auditLogs: logsRes.data || [],
        payouts: payoutsRes.data || [],
        reportsCount: reportsRes.count || 0,
        reports: reportsRes.data || [],
        disputes: disputeDetailsRes.data || [],
        transactions: transactionsRes.data || [],
        stripeAccountId: profilesPrivateRes.data?.stripe_account_id ?? null,
        stripeOnboardingStatus:
          profilesPrivateRes.data?.stripe_onboarding_status ?? null,
        phoneNumber: profilesPrivateRes.data?.phone_number ?? null,
        lastSignInAt: profilesPrivateRes.data?.last_sign_in_at ?? null,
        sellerTrustStats: sellerTrustStatsRes.data,
        reviews,
        avgRating,
        metrics: {
          sales: (volumeRes.data as any[])?.length || 0,
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
