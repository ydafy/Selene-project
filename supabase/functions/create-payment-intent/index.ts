import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@12.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// 1. MAPEO DE DIMENSIONES (Sincronizado con el Frontend)
const PACKAGE_DIMENSIONS: Record<
  string,
  { length: number; width: number; height: number; weight: number }
> = {
  ram_1: { length: 15, width: 15, height: 15, weight: 1 },
  ram_2: { length: 20, width: 15, height: 10, weight: 1 },
  cpu_1: { length: 15, width: 15, height: 15, weight: 1 },
  cpu_2: { length: 20, width: 15, height: 10, weight: 1 },
  gpu_1: { length: 30, width: 23, height: 15, weight: 3 },
  gpu_2: { length: 41, width: 30, height: 20, weight: 5 },
  mobo_1: { length: 46, width: 30, height: 15, weight: 5 },
};

const DEFAULT_DIM = { length: 20, width: 15, height: 10, weight: 1 };

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2022-11-15',
  httpClient: Stripe.createFetchHttpClient(),
});

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    // A. Inicializar Supabase y Auth
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      },
    );

    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Usuario no autenticado');

    // B. Recibir datos del Checkout
    const { productIds, shippingAddress, selectedCarriers } = await req.json();
    const destZip = shippingAddress?.zip_code;

    console.log(`[DEBUG] Iniciando cobro para usuario: ${user.id}`);
    console.log(
      `[DEBUG] Destino: ${destZip}, Productos: ${JSON.stringify(productIds)}`,
    );
    console.log(
      `[DEBUG] Carriers seleccionados: ${JSON.stringify(selectedCarriers)}`,
    );

    if (!destZip) throw new Error('Falta el código postal de destino');

    // C. Consultar productos en DB
    const { data: products, error: dbError } = await supabaseClient
      .from('products')
      .select('*')
      .in('id', productIds);

    if (dbError || !products)
      throw new Error('Error al buscar productos en DB');

    let subtotal = 0;
    let totalShipping = 0;

    // D. Recalcular Totales usando selecciones del usuario
    for (const item of products) {
      if (item.status !== 'VERIFIED')
        throw new Error(`Producto ${item.name} no disponible`);

      subtotal += item.price;

      if (item.shipping_payer === 'seller') {
        console.log(`[DEBUG] Item ${item.id}: Envío pagado por vendedor ($0)`);
        totalShipping += 0;
      } else {
        const selectedCarrier = selectedCarriers?.[item.id];
        const dim = PACKAGE_DIMENSIONS[item.package_preset] || DEFAULT_DIM;

        if (selectedCarrier) {
          console.log(
            `[DEBUG] Item ${item.id}: Usando carrier seleccionado ${selectedCarrier}`,
          );

          const enviaRes = await fetch(
            `${Deno.env.get('ENVIA_API_URL')}/ship/rate`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${Deno.env.get('ENVIA_API_KEY')}`,
              },
              body: JSON.stringify({
                origin: { country: 'MX', postalCode: item.origin_zip },
                destination: { country: 'MX', postalCode: destZip },
                packages: [
                  { type: 'box', dimensions: dim, weight: dim.weight },
                ],
                shipment: { carrier: selectedCarrier, type: 1 },
              }),
            },
          );

          const enviaData = await enviaRes.json();

          if (enviaData.data && enviaData.data.length > 0) {
            const cost = Math.ceil(enviaData.data[0].totalPrice + 50);
            console.log(`[DEBUG] Cotización para ${item.id}: $${cost}`);
            totalShipping += cost;
          } else {
            console.warn(
              `[DEBUG] Falló Envia para ${item.id}. Usando fallback: ${item.shipping_cost}`,
            );
            totalShipping += Number(item.shipping_cost || 250);
          }
        } else {
          console.error(
            `[FATAL] Item ${item.id} requiere envío pero no se seleccionó carrier.`,
          );
          throw new Error(
            `Falta selección de paquetería para ${item.name}. Por favor regresa al checkout.`,
          );
        }
      }
    }

    // E. Calcular Comisiones (3% + $5)
    const serviceFee =
      Math.round(((subtotal + totalShipping) * 0.03 + 5) * 100) / 100;
    const finalTotal = subtotal + totalShipping + serviceFee;
    const finalTotalCents = Math.round(finalTotal * 100);

    console.log(
      `[DEBUG] Desglose Final: Subtotal: ${subtotal}, Envío: ${totalShipping}, Fee: ${serviceFee}, Total: ${finalTotal}`,
    );

    // F. Crear PaymentIntent en Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: finalTotalCents,
      currency: 'mxn',
      automatic_payment_methods: { enabled: true },
      metadata: {
        buyer_id: user.id,
        product_ids: JSON.stringify(productIds),
        total_shipping: totalShipping.toString(),
      },
    });

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        amount: finalTotal,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[FATAL ERROR]', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
