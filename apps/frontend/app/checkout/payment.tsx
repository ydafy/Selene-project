import React, { useEffect, useState } from 'react';
import { Alert, ActivityIndicator } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import { useRouter, Stack } from 'expo-router';

import { Box, Text } from '../../components/base';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { GlobalHeader } from '../../components/layout/GlobalHeader';
import { ScreenLayout } from '../../components/layout/ScreenLayout';

import { useCartStore } from '../../core/store/useCartStore';
import { useCheckoutStore } from '../../core/store/useCheckoutStore';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { supabase } from '../../core/db/supabase';
import { useOrderCalculations } from '../../core/hooks/useOrderCalculations';

export default function PaymentScreen() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [loading, setLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // Estado para guardar el ID de la transacción de Stripe
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);

  const router = useRouter();
  const { session } = useAuthContext();

  // Datos del pedido
  const { items, clearCart } = useCartStore();
  const { selectedAddress, selectedShippingMethods } = useCheckoutStore();

  // 2. OBTENER TOTALES (Para guardar en DB)
  const { total } = useOrderCalculations(items, selectedShippingMethods);

  // INICIALIZAR STRIPE
  useEffect(() => {
    initializePayment();
  }, []);

  const initializePayment = async () => {
    if (!session?.user || items.length === 0 || !selectedAddress) {
      Alert.alert('Error', 'Faltan datos para procesar el pago.');
      router.back();
      return;
    }

    setLoading(true);

    try {
      // Preparar mapa de carriers seleccionados (productId -> carrier)
      const selectedCarriers: Record<string, string> = {};
      Object.keys(selectedShippingMethods).forEach((productId) => {
        selectedCarriers[productId] =
          selectedShippingMethods[productId].carrier;
      });

      // A. Llamar a Edge Function
      const { data, error } = await supabase.functions.invoke(
        'create-payment-intent',
        {
          body: {
            productIds: items.map((i) => i.id),
            shippingAddress: selectedAddress,
            selectedCarriers,
          },
        },
      );

      if (error || !data?.clientSecret) {
        throw new Error(error?.message || 'No se pudo iniciar el pago.');
      }

      // Guardamos el ID del intento (El clientSecret se ve como "pi_12345_secret_abcde")
      // El ID es la primera parte "pi_12345"
      const pId = data.clientSecret.split('_secret_')[0];
      setPaymentIntentId(pId);

      // B. Inicializar Hoja de Pago
      const { error: stripeError } = await initPaymentSheet({
        merchantDisplayName: 'Selene Marketplace',
        paymentIntentClientSecret: data.clientSecret,
        defaultBillingDetails: {
          name: selectedAddress.full_name,
          phone: selectedAddress.phone,
          address: {
            country: 'MX',
            city: selectedAddress.city,
            state: selectedAddress.state,
            postalCode: selectedAddress.zip_code,
            line1: selectedAddress.street_line1,
            line2: selectedAddress.street_line2 || undefined,
          },
        },
        returnURL: 'selene://checkout/success',
      });

      if (stripeError) throw stripeError;

      setIsReady(true);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error desconocido';
      console.error(e);
      Alert.alert('Error', message);
      router.back();
    } finally {
      setLoading(false);
    }
  };

  // ABRIR HOJA DE PAGO
  const openPaymentSheet = async () => {
    const { error } = await presentPaymentSheet();

    if (error) {
      if (error.code === 'Canceled') {
        return; // Usuario canceló
      }
      Alert.alert('Error en el pago', error.message);
    } else {
      // ¡PAGO EXITOSO! -> CREAR ORDEN
      await handleOrderCreation();
    }
  };

  // 3. LÓGICA DE CREACIÓN DE ORDEN (DB)
  const handleOrderCreation = async () => {
    if (!session?.user.id || !paymentIntentId || !selectedAddress) return;

    setLoading(true);
    try {
      // A. Insertar la Orden Principal
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert({
          buyer_id: session.user.id,
          total_amount: total,
          stripe_payment_intent_id: paymentIntentId,
          status: 'paid',
          shipping_address: selectedAddress, // Se guarda como JSONB snapshot
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // B. Insertar los Items de la Orden
      const orderItemsData = items.map((item) => ({
        order_id: orderData.id,
        product_id: item.id,
        seller_id: item.seller_id,
        price_at_purchase: item.price,
        selected_carrier: selectedShippingMethods[item.id]?.carrier || null,
      }));

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItemsData);

      if (itemsError) throw itemsError;

      // C. Marcar Productos como VENDIDOS
      const productIds = items.map((i) => i.id);
      const { error: updateError } = await supabase
        .from('products')
        .update({ status: 'SOLD' })
        .in('id', productIds);

      if (updateError) throw updateError;

      // D. Limpieza y Éxito
      clearCart();

      // Feedback visual
      Alert.alert(
        '¡Compra Exitosa!',
        'Tu pedido ha sido procesado correctamente.',
        [
          {
            text: 'Ir a Mis Pedidos',
            onPress: () => router.replace('/(tabs)/profile'),
          },
        ],
      );
    } catch (error) {
      console.error('Critical Order Error:', error);
      // Nota: Aquí el pago ya se hizo en Stripe pero falló la DB.
      // En producción, esto debería enviar una alerta crítica a Sentry/Slack para soporte manual.
      Alert.alert(
        'Atención',
        'El pago fue exitoso pero hubo un error guardando la orden. Contacta a soporte con este ID: ' +
          paymentIntentId,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ title: 'Pago Seguro', headerShown: false }} />
      <GlobalHeader
        title="Procesar Pago"
        showBack={true}
        backgroundColor="cardBackground"
      />

      <ScreenLayout>
        <Box flex={1} justifyContent="center" alignItems="center" padding="l">
          <Text variant="header-xl" textAlign="center" marginBottom="m">
            Estás a un paso
          </Text>
          <Text
            variant="body-md"
            color="textSecondary"
            textAlign="center"
            marginBottom="xl"
          >
            Tu dinero estará protegido por Selene hasta que recibas el producto.
          </Text>

          {loading ? (
            <Box alignItems="center">
              <ActivityIndicator size="large" color="#bd9f65" />
              <Text variant="body-sm" color="textSecondary" marginTop="s">
                Procesando...
              </Text>
            </Box>
          ) : (
            <PrimaryButton
              onPress={openPaymentSheet}
              disabled={!isReady}
              icon="credit-card-check-outline"
            >
              Pagar ${total.toLocaleString('es-MX')}
            </PrimaryButton>
          )}
        </Box>
      </ScreenLayout>
    </Box>
  );
}
