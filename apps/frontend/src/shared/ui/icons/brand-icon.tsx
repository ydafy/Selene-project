import React from 'react';
import { SvgProps } from 'react-native-svg';
import { Box } from '../base';

// Importamos los iconos
import { NvidiaIcon } from './brands/nvidia-icon';
import { AmdIcon } from './brands/amd-icon';
import { IntelIcon } from './brands/intel-icon';
import { AsusIcon } from './brands/asus-icon';
import { GigabyteIcon } from './brands/gigabyte-icon';
import { CorsairIcon } from './brands/corsair-icon';
import { GSkillIcon } from './brands/g-skill-icon';
import { AsrockIcon } from './brands/asrock-icon';
import { MsiIcon } from './brands/msi-icon';
import { HyperXIcon } from './brands/hyper-x-icon';
import { KingstonIcon } from './brands/kingston-icon';
import { TForceIcon } from './brands/t-force-icon';
import { XpgIcon } from './brands/xpg-icon';
import { VisaIcon } from './brands/visa-icon';
import { MasterCardIcon } from './brands/master-card-icon';
import { AmexIcon } from './brands/amex-icon';

// 1. Definimos la configuración para cada marca
type BrandConfig = {
  component: React.FC<SvgProps>;
  scale?: number; // Multiplicador de tamaño (1.0 es normal, 1.5 es 50% más grande)
  offsetY?: number; // Ajuste vertical en píxeles (positivo baja, negativo sube)
};

// 2. EL MAPA MAESTRO: Aquí es donde ajustas manualmente cada uno
const BRAND_MAP: Record<string, BrandConfig> = {
  nvidia: {
    component: NvidiaIcon,
    scale: 1.0, // El ojo suele verse bien por defecto
  },
  amd: {
    component: AmdIcon,
    scale: 1.0, // La flecha a veces necesita un empujoncito
  },
  intel: {
    component: IntelIcon,
    scale: 1.6, // <--- AJUSTE: Intel es muy ancho, necesita ser MUCHO más grande para verse bien
    offsetY: 1, // A veces hay que bajarlo un pixel para centrarlo con el texto
  },
  asus: {
    component: AsusIcon,
    scale: 1.3, // El texto suele verse chico
  },
  gigabyte: {
    component: GigabyteIcon,
    scale: 1.0,
  },
  corsair: {
    component: CorsairIcon,
    scale: 0.9,
  },

  'g.skill': {
    component: GSkillIcon,
    scale: 2,
  },

  asrock: {
    component: AsrockIcon,
    scale: 2.2,
  },
  msi: {
    component: MsiIcon,
    scale: 1.2,
    offsetY: -1.8,
  },
  hyperx: { component: HyperXIcon, scale: 2.0 },
  kingston: { component: KingstonIcon, scale: 1.1, offsetY: -1.8 },

  teamgroup: { component: TForceIcon, scale: 1.7, offsetY: -1.6 },
  't-force': { component: TForceIcon, scale: 1.7, offsetY: -1.6 },

  xpg: { component: XpgIcon, scale: 1.8, offsetY: 1.6 },
  adata: { component: XpgIcon, scale: 1.8, offsetY: 1.8 },
  visa: {
    component: VisaIcon,
    scale: 1.0,
  },
  amex: {
    component: AmexIcon,
    scale: 1.2,
  },
  'american express': {
    component: AmexIcon,
    scale: 1.2,
  },
  mastercard: {
    component: MasterCardIcon,
    scale: 1,
  },
};

type BrandIconProps = {
  name: string;
  size?: number; // Tamaño base (ej. 20)
  color?: string;
};

export const BrandIcon = ({ name, size = 24, color }: BrandIconProps) => {
  const normalizedName = name.toLowerCase().trim();
  const config = BRAND_MAP[normalizedName];

  if (!config) {
    return null;
  }

  const IconComponent = config.component;

  // 3. Calculamos el tamaño final basado en la escala específica de la marca
  const scale = config.scale ?? 1.0;
  const finalSize = size * scale;
  const translateY = config.offsetY ?? 0;

  return (
    // El contenedor mantiene el tamaño base para no romper el layout de la fila
    <Box
      width={size}
      height={size}
      justifyContent="center"
      alignItems="center"
      // overflow="visible" es vital para permitir que el icono se salga un poco si lo escalamos
      overflow="visible"
    >
      <Box style={{ transform: [{ translateY }] }}>
        <IconComponent width={finalSize} height={finalSize} color={color} />
      </Box>
    </Box>
  );
};
/**
 * Helper para saber si tenemos icono para una marca específica.
 * Útil para filtrar listas.
 */
export const hasBrandIcon = (name: string): boolean => {
  const normalizedName = name.toLowerCase().trim();
  return !!BRAND_MAP[normalizedName];
};
