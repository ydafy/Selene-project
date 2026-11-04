import { useSafeAreaInsets } from 'react-native-safe-area-context';
//import { useTheme } from '@shopify/restyle';
import { Box } from '../base';
//import { Theme } from '../../core/theme';

type BottomActionBarProps = {
  children: React.ReactNode;
  showBorder?: boolean;
};

export const BottomActionBar = ({
  children,
  //showBorder = true,
}: BottomActionBarProps) => {
  const insets = useSafeAreaInsets();
  //const theme = useTheme<Theme>();

  return (
    <Box
      position="absolute"
      bottom={0}
      left={0}
      right={0}
      paddingHorizontal="m"
      paddingTop="m"
      // Padding inferior dinámico: usa el inset del dispositivo o un mínimo de 20
      style={{ paddingBottom: Math.max(insets.bottom, 20) }}
      //borderTopWidth={showBorder ? 1 : 0}
      //borderTopColor="cardBackground"
    >
      {children}
    </Box>
  );
};
