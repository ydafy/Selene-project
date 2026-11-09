import { TouchableOpacity } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { Box } from '@/shared/ui/base';
import { Theme } from '@/shared/theme';
import { BrandIcon } from '@/shared/ui/icons/brand-icon';

type BrandCircleProps = {
  brandName: string;
  isSelected: boolean;
  onPress: () => void;
};

export const BrandCircle = ({
  brandName,
  isSelected,
  onPress,
}: BrandCircleProps) => {
  const theme = useTheme<Theme>();

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <Box
        width={65} // Un poco más compacto
        height={50}
        borderRadius="full"
        justifyContent="center"
        alignItems="center"
        // FONDO SIEMPRE TRANSPARENTE
        backgroundColor="transparent"
        // BORDE: Solo visible y amarillo si está seleccionado
        // Si no está seleccionado, podemos dejarlo transparente o un gris muy sutil
        borderWidth={isSelected ? 1 : 2}
        borderColor={isSelected ? 'primary' : 'transparent'}
        marginRight="s"
      >
        <BrandIcon
          name={brandName}
          size={24}
          // El icono cambia de color: Gris (inactivo) -> Amarillo (activo)
          color={isSelected ? theme.colors.primary : theme.colors.textSecondary}
        />
      </Box>
    </TouchableOpacity>
  );
};
