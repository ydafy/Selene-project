/* eslint-disable @typescript-eslint/no-explicit-any */
import { ScrollView } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { Box } from '../../base';
import { ProfileActionButton } from './ProfileActionButton';
import { Theme } from '../../../core/theme';

export const ProfileActionsBar = () => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('profile');
  const router = useRouter();

  const actions = [
    {
      label: t('menu.orders'),
      icon: 'package-variant-closed',
      onPress: () => console.log('Ir a Pedidos'),
    },
    {
      label: t('menu.listings'),
      icon: 'tag-multiple-outline',
      onPress: () => router.push('/profile/listings'),
    },
    {
      label: t('menu.addresses'),
      icon: 'map-marker-outline',
      onPress: () => console.log('Abrir Modal Direcciones'),
    },
    {
      label: t('menu.payments'),
      icon: 'credit-card-outline',
      onPress: () => console.log('Ir a Pagos'),
    },
  ];

  return (
    <Box
      marginHorizontal="m"
      marginTop="m"
      backgroundColor="cardBackground"
      borderRadius="l"
      paddingVertical="m"
      position="relative"
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 5,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16 }}
      >
        {actions.map((action, index) => (
          <ProfileActionButton
            key={index}
            label={action.label}
            icon={action.icon as any}
            onPress={action.onPress}
          />
        ))}
      </ScrollView>

      {/* Efecto Fade a la derecha */}
      <LinearGradient
        colors={['transparent', theme.colors.cardBackground]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 24,
          borderTopRightRadius: theme.borderRadii.l,
          borderBottomRightRadius: theme.borderRadii.l,
        }}
        pointerEvents="none"
      />
    </Box>
  );
};
