import { useState } from 'react';
import { Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { IconButton, Divider } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Box, Text } from '../base';
import { Theme } from '../../core/theme';
import { useModeration } from '../../core/hooks/useModeration';
import { useAuthContext } from '../../components/auth/AuthProvider';

type OptionsMenuProps = {
  targetId: string; // ID del producto o usuario
  sellerId: string; // ID del usuario a bloquear
  context: 'product' | 'user'; // Para saber qué textos mostrar
  isOwner?: boolean;
};

export const OptionsMenu = ({
  targetId,
  sellerId,
  context,
  isOwner = false,
}: OptionsMenuProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation(['product', 'auth']);
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const { reportEntity, blockUser } = useModeration();

  if (isOwner) {
    return null;
  }

  const [visible, setVisible] = useState(false);

  const openMenu = () => setVisible(true);
  const closeMenu = () => setVisible(false);

  const handleAction = async (action: 'report' | 'block') => {
    closeMenu();

    if (!session) {
      Toast.show({
        type: 'info',
        text1: t('auth:guards.loginRequiredTitle'),
        text2: t('auth:guards.loginRequiredMsg'),
        position: 'top',
      });
      return;
    }

    // Pequeño delay para UX
    setTimeout(async () => {
      if (action === 'report') {
        const { error } = await reportEntity(targetId, context);
        if (!error) {
          Toast.show({
            type: 'success',
            text1: t('menu.reportSentTitle'),
            text2: t('menu.reportSentMsg'),
            position: 'top',
          });
        }
      } else {
        const { error } = await blockUser(sellerId);
        if (!error) {
          Toast.show({
            type: 'info',
            text1: t('menu.userBlockedTitle'),
            text2: t('menu.userBlockedMsg'),
            position: 'top',
          });
        }
      }
    }, 200);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MenuItem = ({ icon, label, onPress, color }: any) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <Box flexDirection="row" alignItems="center" padding="m">
        <MaterialCommunityIcons name={icon} size={20} color={color} />
        <Text
          variant="body-md"
          color="textPrimary"
          style={{ marginLeft: 12, fontFamily: 'Montserrat-Regular' }}
        >
          {label}
        </Text>
      </Box>
    </TouchableOpacity>
  );

  return (
    <>
      <IconButton
        icon="dots-vertical"
        iconColor={theme.colors.textPrimary}
        size={24}
        onPress={openMenu}
        style={{ margin: 0 }}
      />

      <Modal
        transparent={true}
        visible={visible}
        animationType="fade"
        onRequestClose={closeMenu}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={closeMenu}
        >
          <TouchableOpacity activeOpacity={1} style={{ width: '100%' }}>
            <Box
              position="absolute"
              top={insets.top + 90}
              right={theme.spacing.m}
              width={220}
              backgroundColor="cardBackground"
              borderRadius="m"
              style={styles.shadow}
            >
              <MenuItem
                icon="flag-outline"
                label={t('menu.report')}
                onPress={() => handleAction('report')}
                color={theme.colors.textPrimary}
              />

              <Divider style={{ backgroundColor: theme.colors.background }} />

              <MenuItem
                icon="account-cancel-outline"
                label={t('menu.blockSeller')}
                onPress={() => handleAction('block')}
                color={theme.colors.textPrimary}
              />
            </Box>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
});
