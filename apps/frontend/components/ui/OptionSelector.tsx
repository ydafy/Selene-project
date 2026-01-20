import { useState, useMemo } from 'react';
import { TouchableOpacity, Dimensions } from 'react-native'; // <--- 1. Dimensions
import {
  BottomSheetFlatList,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box, Text } from '../base';
import { Theme } from '../../core/theme';

type OptionSelectorProps = {
  options: string[];
  onSelect: (value: string) => void;
  onClose: () => void;
  title: string;
  searchable?: boolean;
};

// 2. CÁLCULO DE ALTURA FIJA (Fuerza bruta)
// Calculamos exactamente el 85% de la altura de la pantalla.
// Al ser un valor fijo, el layout no puede "colapsar" dinámicamente.
const SCREEN_HEIGHT = Dimensions.get('window').height;
const MODAL_HEIGHT = SCREEN_HEIGHT * 0.85;
const KEYBOARD_BUFFER = Dimensions.get('window').height * 0.45;

export const OptionSelector = ({
  options,
  onSelect,
  onClose,
  title,
  searchable = false,
}: OptionSelectorProps) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const filteredOptions = useMemo(() => {
    if (!searchable || !query) return options;
    return options.filter((opt) =>
      opt.toLowerCase().includes(query.toLowerCase()),
    );
  }, [options, query, searchable]);

  const renderItem = ({ item }: { item: string }) => (
    <TouchableOpacity
      onPress={() => {
        onSelect(item);
        onClose();
      }}
      activeOpacity={0.7}
    >
      <Box
        paddingVertical="m"
        paddingHorizontal="m"
        borderBottomWidth={1}
        borderBottomColor="background"
      >
        <Text variant="body-md" color="textPrimary">
          {item}
        </Text>
      </Box>
    </TouchableOpacity>
  );

  const renderEmpty = () => (
    <Box alignItems="center" justifyContent="center" paddingTop="xl">
      <MaterialCommunityIcons
        name="magnify-remove-outline"
        size={48}
        color={theme.colors.textSecondary}
      />
      <Text variant="body-md" color="textSecondary" marginTop="s">
        No se encontraron resultados
      </Text>
    </Box>
  );

  return (
    // 3. APLICAMOS LA ALTURA FIJA
    // Quitamos flex={1} y usamos height={MODAL_HEIGHT}
    <Box height={MODAL_HEIGHT} backgroundColor="cardBackground">
      {/* HEADER */}
      <Box
        paddingHorizontal="m"
        paddingBottom="m"
        borderBottomWidth={1}
        borderBottomColor="background"
      >
        <Box
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Text variant="subheader-md" fontWeight="bold">
            {title}
          </Text>
          <IconButton
            icon="close"
            iconColor={theme.colors.textSecondary}
            size={24}
            onPress={onClose}
          />
        </Box>
      </Box>

      {/* SEARCH BAR */}
      {searchable && (
        <Box padding="m">
          <Box
            flexDirection="row"
            alignItems="center"
            backgroundColor="background"
            borderRadius="s"
            paddingHorizontal="m"
            height={45}
            borderWidth={1}
            borderColor="textSecondary"
          >
            <MaterialCommunityIcons
              name="magnify"
              size={20}
              color={theme.colors.textSecondary}
            />
            <BottomSheetTextInput
              placeholder="Buscar..."
              placeholderTextColor={theme.colors.textSecondary}
              style={{
                flex: 1,
                marginLeft: 8,
                color: theme.colors.textPrimary,
                fontFamily: 'Montserrat-Medium',
                fontSize: 16,
              }}
              value={query}
              onChangeText={setQuery}
            />
          </Box>
        </Box>
      )}

      {/* LISTA */}
      <BottomSheetFlatList
        data={filteredOptions}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        keyExtractor={(item: any) => item}
        renderItem={renderItem}
        // flex: 1 aquí está bien porque su padre (Box) ya tiene altura fija
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingBottom: insets.bottom + KEYBOARD_BUFFER,
        }}
        ListEmptyComponent={renderEmpty}
        keyboardShouldPersistTaps="handled"
      />
    </Box>
  );
};
