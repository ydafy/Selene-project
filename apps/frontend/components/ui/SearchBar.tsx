import { TextInput, TouchableOpacity } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Box } from '../base';
import { Theme } from '../../core/theme';

type SearchBarProps = {
  placeholder?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  onSubmit?: () => void;
  onFocus?: () => void;
  readOnly?: boolean;
  onPress?: () => void;
  autoFocus?: boolean;
};

export const SearchBar = ({
  placeholder,
  value,
  onChangeText,
  onSubmit,
  onFocus,
  readOnly = false,
  onPress,
  autoFocus = false,
  ...rest
}: SearchBarProps & React.ComponentProps<typeof TextInput>) => {
  const theme = useTheme<Theme>();

  const handleClear = () => {
    if (onChangeText) {
      onChangeText('');
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={readOnly ? onPress : undefined}
    >
      <Box
        flexDirection="row"
        alignItems="center"
        backgroundColor="cardBackground"
        height={50}
        borderRadius="full"
        paddingHorizontal="m"
        borderWidth={1}
        borderColor="background"
      >
        <MaterialCommunityIcons
          name="magnify"
          size={24}
          color={theme.colors.textSecondary}
        />

        <Box flex={1} marginLeft="s">
          <TextInput
            placeholder={placeholder}
            placeholderTextColor={theme.colors.textSecondary}
            value={value}
            onChangeText={onChangeText}
            onSubmitEditing={onSubmit}
            onFocus={onFocus}
            editable={!readOnly}
            autoFocus={autoFocus}
            style={{
              color: theme.colors.textPrimary,
              fontFamily: 'Montserrat-Medium',
              fontSize: 16,
              height: '100%',
            }}
            returnKeyType="search"
            {...rest}
          />
        </Box>

        {/* Botón de Limpiar (Solo si hay texto y no es readOnly) */}
        {!readOnly && value && value.length > 0 && (
          <TouchableOpacity onPress={handleClear}>
            <Box
              padding="xs"
              borderRadius="full"
              backgroundColor="background" // Fondo sutil para la X
            >
              <MaterialCommunityIcons
                name="close"
                size={16}
                color={theme.colors.textSecondary}
              />
            </Box>
          </TouchableOpacity>
        )}
      </Box>
    </TouchableOpacity>
  );
};
