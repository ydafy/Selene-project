import * as React from 'react';
import Svg, { Path, SvgProps } from 'react-native-svg';

export const AmdIcon = (props: SvgProps) => (
  <Svg
    viewBox="0 0 48 48" // El viewBox original de tu SVG (48x48)
    width="100%" // Se adapta al contenedor padre
    height="100%"
    fill="none"
    {...props}
  >
    <Path
      d="m33.614 33.614 9.25 9.25v-37h-37l9.25 9.25h18.5v18.5zM15.114 33.614V19.55l-9.229 9.228-.021 14.086 14.085-.022 9.228-9.228H15.114z"
      fill="#ED1C24" // Rojo Oficial AMD. (Pon #E4E4E4 si lo quieres blanco como el texto)
    />
  </Svg>
);
