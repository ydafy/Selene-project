import React, { useCallback, useMemo, useState } from 'react';
import { Image, StyleSheet, TouchableOpacity } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import ImageViewing from 'react-native-image-viewing';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';

// --- 1. ASSETS: BENCHMARK (GPU/CPU) ---
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bench1 = require('../../../assets/images/step1.jpg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bench2 = require('../../../assets/images/step2.jpg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bench3 = require('../../../assets/images/step3.jpg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bench4 = require('../../../assets/images/step4.jpg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bench5 = require('../../../assets/images/step5.jpg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bench6 = require('../../../assets/images/step6.jpg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bench7 = require('../../../assets/images/step7.jpg');

// --- 2. ASSETS: INFO (RAM) ---

// eslint-disable-next-line @typescript-eslint/no-require-imports
const info1 = require('../../../assets/images/ramStep1.jpg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const info2 = require('../../../assets/images/ramStep2.jpg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const info3 = require('../../../assets/images/ramStep3.jpg');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const info4 = require('../../../assets/images/ramStep4.jpg'); // Placeholder

// --- 2. ASSETS: INFO (MOBO) ---

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mobo1 = require('../../../assets/images/ramStep1.jpg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mobo2 = require('../../../assets/images/moboStep2.jpg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mobo3 = require('../../../assets/images/moboStep3.jpg');

export type GuideType = 'benchmark' | 'info' | 'mobo';

type BenchmarkGuideModalProps = {
  innerRef: React.RefObject<BottomSheetModal | null>;
  onDismiss: () => void;
  type: GuideType;
};

export const BenchmarkGuideModal = ({
  innerRef,
  onDismiss,
  type,
}: BenchmarkGuideModalProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('verify');
  const snapPoints = useMemo(() => ['85%'], []);

  const [viewerVisible, setViewerVisible] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // --- 3. CONFIGURACIÓN DINÁMICA ---
  const config = useMemo(() => {
    if (type === 'benchmark') {
      return {
        // Título del Modal (Usa la clave existente)
        title: t('guide.benchmark.modalTitle'),
        steps: [
          {
            title: t('guide.benchmark.step1Title'),
            desc: t('guide.benchmark.step1Desc'),
            img: bench1,
          },
          {
            title: t('guide.benchmark.step2Title'),
            desc: t('guide.benchmark.step2Desc'),
            img: bench2,
          },
          {
            title: t('guide.benchmark.step3Title'),
            desc: t('guide.benchmark.step3Desc'),
            img: bench3,
          },
          {
            title: t('guide.benchmark.step4Title'),
            desc: t('guide.benchmark.step4Desc'),
            img: bench4,
          },
          {
            title: t('guide.benchmark.step5Title'),
            desc: t('guide.benchmark.step5Desc'),
            img: bench5,
          },
          {
            title: t('guide.benchmark.step6Title'),
            desc: t('guide.benchmark.step6Desc'),
            img: bench6,
          },
          {
            title: t('guide.benchmark.step7Title'),
            desc: t('guide.benchmark.step7Desc'),
            img: bench7,
          },
        ],
      };
    } else if (type === 'info') {
      return {
        title: t('guide.info.title'),
        steps: [
          {
            title: t('guide.info.step1Title'),
            desc: t('guide.info.step1Desc'),
            img: info1,
          },
          {
            title: t('guide.info.step2Title'),
            desc: t('guide.info.step2Desc'),
            img: info2,
          },
          {
            title: t('guide.info.step3Title'),
            desc: t('guide.info.step3Desc'),
            img: info3,
          },
          {
            title: t('guide.info.step4Title'),
            desc: t('guide.info.step4Desc'),
            img: info4,
          },
        ],
      };
    } else {
      return {
        title: t('guide.mobo.title'),
        steps: [
          {
            title: t('guide.mobo.step1Title'),
            desc: t('guide.mobo.step1Desc'),
            img: mobo1,
          },
          {
            title: t('guide.mobo.step2Title'),
            desc: t('guide.mobo.step2Desc'),
            img: mobo2,
          },
          {
            title: t('guide.mobo.step3Title'),
            desc: t('guide.mobo.step3Desc'),
            img: mobo3,
          },
        ],
      };
    }
  }, [type, t]);

  // Array de imágenes para el visor (se regenera según el tipo)
  const imagesForViewer = config.steps.map((s) => s.img);

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

  const handleImagePress = (index: number) => {
    setCurrentImageIndex(index);
    setViewerVisible(true);
  };

  const Step = ({
    title,
    desc,
    image,
    index,
  }: {
    title: string;
    desc: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    image: any;
    index: number;
  }) => (
    <Box marginBottom="xl">
      {/* Título: Dorado y con peso */}
      <Text variant="subheader-md" color="primary" marginBottom="s">
        {title}
      </Text>

      {/* Descripción: Mejor lectura */}
      <Box
        marginBottom="m"
        paddingLeft="s" // Pequeña indentación para jerarquía
        borderLeftWidth={2} // Línea decorativa sutil a la izquierda
        borderLeftColor="cardBackground" // O un gris muy tenue
      >
        <Text
          variant="body-md"
          color="textPrimary"
          style={{
            lineHeight: 24, // <--- CLAVE: Más espacio entre líneas para que no se vea apretado
            opacity: 0.9, // Un poco menos intenso que el título
          }}
        >
          {desc}
        </Text>
      </Box>

      {/* Imagen (Igual que antes) */}
      <TouchableOpacity
        onPress={() => handleImagePress(index)}
        activeOpacity={0.9}
      >
        <Box
          height={220} // Un poco más alto para que luzca mejor
          width="100%"
          borderRadius="m"
          overflow="hidden"
          backgroundColor="background"
          borderWidth={1}
          borderColor="textSecondary"
          position="relative"
        >
          <Image
            source={image}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain" // Cover suele verse mejor si la captura tiene "aire" alrededor
          />

          <Box
            position="absolute"
            bottom={8}
            right={8}
            backgroundColor="separator" // Fondo oscuro para el icono
            borderRadius="full"
            padding="xs"
          >
            <MaterialCommunityIcons
              name="magnify-plus-outline"
              size={20}
              color="white"
            />
          </Box>
        </Box>
      </TouchableOpacity>
    </Box>
  );

  return (
    <>
      <BottomSheetModal
        ref={innerRef}
        index={0}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: theme.colors.cardBackground }}
        handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
        onDismiss={onDismiss}
        enablePanDownToClose={true}
      >
        <BottomSheetScrollView contentContainerStyle={styles.content}>
          <Text variant="header-xl" textAlign="center" marginBottom="l">
            {config.title}
          </Text>

          {config.steps.map((step, index) => (
            <Step
              key={index}
              index={index}
              title={step.title}
              desc={step.desc}
              image={step.img}
            />
          ))}

          <Box height={40} />
        </BottomSheetScrollView>
      </BottomSheetModal>

      <ImageViewing
        images={imagesForViewer}
        imageIndex={currentImageIndex}
        visible={viewerVisible}
        onRequestClose={() => setViewerVisible(false)}
        swipeToCloseEnabled={true}
        doubleTapToZoomEnabled={true}
        animationType="fade"
        backgroundColor="#000000"
        HeaderComponent={() => (
          <Box position="absolute" top={50} right={20} zIndex={1}>
            <TouchableOpacity
              onPress={() => setViewerVisible(false)}
              style={{
                backgroundColor: 'separator',
                padding: 8,
                borderRadius: 20,
              }}
            >
              <MaterialCommunityIcons name="close" size={24} color="white" />
            </TouchableOpacity>
          </Box>
        )}
        FooterComponent={({ imageIndex }) => (
          <Box position="absolute" bottom={40} width="100%" alignItems="center">
            <Text variant="body-md" color="textPrimary">
              Paso {imageIndex + 1} de {config.steps.length}
            </Text>
          </Box>
        )}
      />
    </>
  );
};

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 50,
  },
});
