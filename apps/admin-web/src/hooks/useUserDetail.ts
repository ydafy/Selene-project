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
      // VITAL: El orden en el array de abajo DEBE coincidir con el orden de arriba
      const [
        profileRes,
        bankRes,
        addressRes,
        purchasesRes,
        productsRes,
        notesRes,
        logsRes,
        payoutsRes,
        reportsRes,
        reviewsRes,
        cancelledSalesRes,
        cancelledPurchasesRes,
        purchasedItemsRes,
        volumeRes,
        disputeDetailsRes,
        transactionsRes,
      ] = await Promise.all([
        /* 0  - CRITICAL */ supabase
          .from('admin_user_directory_view')
          .select('*')
          .eq('id', userId)
          .single(),

        /* 1 */ safeQuery(
          supabase
            .from('seller_bank_accounts')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle(),
          null,
        ),
        /* 2 */ safeQuery(
          supabase
            .from('addresses')
            .select('*')
            .eq('user_id', userId)
            .order('is_default', { ascending: false }),
          [],
        ),
        /* 3 */ safeQuery(
          supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('buyer_id', userId)
            .neq('status', 'cancelled')
            .neq('status', 'refunded'),
          [],
        ),
        /* 4 */ safeQuery(
          supabase
            .from('products')
            .select('*')
            .eq('seller_id', userId)
            .order('created_at', { ascending: false })
            .limit(20),
          [],
        ),
        /* 5 */ safeQuery(
          supabase
            .from('admin_user_notes')
            .select('*, admin:profiles!admin_id(username)')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20),
          [],
        ),
        /* 6 */ safeQuery(
          supabase
            .from('admin_audit_logs')
            .select('*, admin:profiles(username)')
            .eq('target_id', userId)
            .order('created_at', { ascending: false })
            .limit(20),
          [],
        ),
        /* 7 */ safeQuery(
          supabase
            .from('payout_requests')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20),
          [],
        ),
        /* 8 */ safeQuery(
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
        /* 9 */ safeQuery(
          supabase
            .from('reviews')
            .select(
              '*, reviewer:profiles!reviews_reviewer_id_fkey(username)',
            )
            .eq('seller_id', userId)
            .order('created_at', { ascending: false }),
          [],
        ),
        /* 10 */ safeQuery(
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
        /* 11 */ safeQuery(
          supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('buyer_id', userId)
            .eq('status', 'cancelled'),
          [],
        ),
        /* 12 */ safeQuery(
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
        /* 13 */ safeQuery(
          supabase
            .from('order_items')
            .select('price_at_purchase, orders!inner(status)')
            .eq('seller_id', userId)
            .eq('orders.status', 'completed'),
          [],
        ),
        /* 14 */ safeQuery(
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
        /* 15 */ safeQuery(
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
      ]);

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
          ? reviews.reduce((acc: number, r: any) => acc + r.rating, 0) / reviews.length
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
        reviews,
        avgRating,
        metrics: {
          sales: profileRes.data.sold_count || 0,
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
