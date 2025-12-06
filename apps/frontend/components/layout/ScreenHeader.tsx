//import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../base';
//import { Theme } from '../../core/theme';

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
};

export const ScreenHeader = ({ title, subtitle }: ScreenHeaderProps) => {
  //const theme = useTheme<Theme>();

  return (
    <Box
      backgroundColor="cardBackground"
      padding="m"
      borderRadius="l" // Bordes redondeados grandes
      marginBottom="m" // Espacio hacia el contenido
      // Sombra sutil para el efecto flotante
      style={{
        shadowColor: '#000',
        shadowOffset: {
          width: 0,
          height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 4.65,
        elevation: 8,
      }}
    >
      <Text variant="header-2xl" lineHeight={32}>
        {title}
      </Text>
      {subtitle && (
        <Text variant="body-md" color="textSecondary" marginTop="xs">
          {subtitle}
        </Text>
      )}
    </Box>
  );
};
