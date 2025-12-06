import { useState } from 'react';
import { useRouter, Stack } from 'expo-router';
import { ScrollView, TouchableOpacity } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Box, Text } from '../../components/base';
import { SearchBar } from '../../components/ui/SearchBar';
import { useSearchStore } from '../../core/store/useSearchStore';
import { Theme } from '../../core/theme';

export default function SearchQueryScreen() {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('search');
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { history, addSearch, removeSearch, clearHistory } = useSearchStore();
  const [query, setQuery] = useState('');

  // Navegar a resultados y guardar en historial
  const handleSearch = (text: string) => {
    if (!text.trim()) return;

    addSearch(text);
    // Replace para que al volver atrás desde resultados, no vuelva al input, sino al shop
    router.replace({
      pathname: '/store/results',
      params: { query: text },
    });
  };

  return (
    <Box
      flex={1}
      backgroundColor="background"
      style={{ paddingTop: insets.top }}
    >
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />

      {/* Header con SearchBar Activa */}
      <Box
        flexDirection="row"
        alignItems="center"
        paddingHorizontal="m"
        paddingBottom="m"
        borderBottomWidth={1}
        borderBottomColor="cardBackground"
      >
        <IconButton
          icon="arrow-left"
          iconColor={theme.colors.textPrimary}
          size={24}
          onPress={() => router.back()}
          style={{ marginLeft: -10 }}
        />
        <Box flex={1}>
          <SearchBar
            placeholder={t('typeToSearch')}
            value={query}
            onChangeText={setQuery}
            onSubmit={() => handleSearch(query)}
            // Truco: autoFocus hace que el teclado suba inmediatamente
            // (Nota: Asegúrate de pasar {...rest} en tu componente SearchBar al TextInput)
            // autoFocus
            // Si autoFocus no funciona directo por el wrapper, usaremos un ref en el futuro
          />
        </Box>
      </Box>

      <ScrollView keyboardShouldPersistTaps="handled">
        {/* Historial */}
        {history.length > 0 && (
          <Box padding="m">
            <Box
              flexDirection="row"
              justifyContent="space-between"
              alignItems="center"
              marginBottom="s"
            >
              <Text variant="subheader-md" color="textPrimary">
                {t('recentSearches')}
              </Text>
              <TouchableOpacity onPress={clearHistory}>
                <Text variant="body-sm" color="primary">
                  {t('clearHistory')}
                </Text>
              </TouchableOpacity>
            </Box>

            {history.map((term, index) => (
              <TouchableOpacity
                key={index}
                onPress={() => handleSearch(term)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.cardBackground,
                }}
              >
                <MaterialCommunityIcons
                  name="history"
                  size={20}
                  color={theme.colors.textSecondary}
                />
                <Text variant="body-md" marginLeft="m" flex={1}>
                  {term}
                </Text>
                <TouchableOpacity onPress={() => removeSearch(term)}>
                  <MaterialCommunityIcons
                    name="close"
                    size={20}
                    color={theme.colors.textSecondary}
                  />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </Box>
        )}
      </ScrollView>
    </Box>
  );
}
