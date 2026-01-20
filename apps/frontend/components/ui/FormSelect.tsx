import { useRef, useMemo, useCallback } from 'react';
import { TouchableOpacity, Keyboard } from 'react-native';
import { TextInput } from 'react-native-paper';
import { BottomSheetModal, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context'; // <--- AGREGADO (Igual que FilterModal)

import { Box } from '../base';
import { Theme } from '../../core/theme';
import { OptionSelector } from './OptionSelector';

type FormSelectProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  error?: boolean;
  leftIcon?: string;
  searchable?: boolean;
};

export const FormSelect = ({
  label,
  value,
  onChange,
  options,
  placeholder,
  error,
  leftIcon,
  searchable = false,
}: FormSelectProps) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets(); // <--- AGREGADO
  const bottomSheetRef = useRef<BottomSheetModal>(null);

  // 1. SNAP POINTS: Idéntico a FilterModal (Fijo al 85%)
  const snapPoints = useMemo(() => ['80%'], []);

  const handlePresentModal = () => {
    Keyboard.dismiss();
    bottomSheetRef.current?.present();
  };

  const renderBackdrop = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.7}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <>
      <TouchableOpacity onPress={handlePresentModal} activeOpacity={0.8}>
        <Box pointerEvents="none">
          <TextInput
            mode="flat"
            label={label}
            value={value}
            placeholder={placeholder}
            editable={false}
            error={error}
            style={{ backgroundColor: 'transparent' }}
            textColor={theme.colors.textPrimary}
            theme={{ colors: { onSurfaceVariant: theme.colors.textSecondary } }}
            left={leftIcon ? <TextInput.Icon icon={leftIcon} /> : undefined}
            right={<TextInput.Icon icon="chevron-down" />}
          />
        </Box>
      </TouchableOpacity>

      <BottomSheetModal
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        // PROPS EXACTAS DE FILTERMODAL:
        topInset={insets.top} // <--- ESTO FALTABA Y ES CRÍTICO
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: theme.colors.cardBackground }}
        handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
        enablePanDownToClose={true}
        android_keyboardInputMode="adjustResize"
      >
        <OptionSelector
          title={`Seleccionar ${label}`}
          options={options}
          onSelect={onChange}
          onClose={() => bottomSheetRef.current?.dismiss()}
          searchable={searchable}
        />
      </BottomSheetModal>
    </>
  );
};
