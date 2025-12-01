import * as React from 'react';
import Svg, { Path, SvgProps } from 'react-native-svg';

export const GigabyteIcon = (props: SvgProps) => (
  <Svg viewBox="0 0 150 150" width="100%" height="100%" fill="none" {...props}>
    {/* Bounding box invisible para mantener el centro */}
    <Path d="M0 0h150v150H0V0Z" fill="none" />

    {/* La 'G' Azul */}
    <Path
      d="M67.17 102.76c-16.27 0-29.54-13.27-29.54-29.54S50.9 43.16 68 43.16h46.05V19.7H64.19C33 19.7 8.09 44.6 8.09 75.14c0 26.2 18.62 49.16 44.18 54.35l64.1-64.09h-39.1v37.08l-10.09.27Z"
      fill="#158dd4"
      fillRule="evenodd"
    />

    {/* El Triángulo Rojo */}
    <Path
      d="M97.19 85.6h46.43l-46.43 46.43V85.6Z"
      fill="#e4032c"
      fillRule="evenodd"
    />
  </Svg>
);
