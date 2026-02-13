import React, { useMemo, useCallback } from 'react';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { CheckoutItem } from './CheckoutItem';
import { Product } from '@selene/types';

interface Props {
  innerRef: React.RefObject<BottomSheetModal | null>;
  items: Product[];
}

export const ProductSummaryModal = ({ innerRef, items }: Props) => {
  const theme = useTheme<Theme>();

  // Puntos de anclaje (Copiado de tu lógica de estabilidad)
  const snapPoints = useMemo(() => ['65%'], []);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.7} // Consistente con tu FilterModal
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={innerRef}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.colors.cardBackground }}
      handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
      enablePanDownToClose={true}
    >
      {/* 1. HEADER FIJO (Fuera del Scroll) */}
      <Box
        padding="m"
        borderBottomWidth={1}
        borderBottomColor="background"
        alignItems="center"
      >
        <Text variant="subheader-md">Detalles del Pedido</Text>
      </Box>

      {/* 2. CONTENIDO SCROLLEABLE (La clave del éxito) */}
      <BottomSheetScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 40, // Espacio extra al final para que el último item respire
        }}
      >
        {items.map((item) => (
          <CheckoutItem key={item.id} product={item} />
        ))}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
};
