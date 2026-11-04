import React, { useEffect, useState } from 'react';
import { Text } from '../base';
import { formatCurrency } from '../../core/utils/format';

type BaseTextProps = React.ComponentProps<typeof Text>;

interface Props extends BaseTextProps {
  value: number;
  duration?: number; // Duración en ms
  isHidden?: boolean; // Modo privacidad
}

export const AnimatedCounter = ({
  value,
  duration = 2000,
  isHidden,
  ...textProps
}: Props) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (isHidden) return; // No animar si está oculto

    let startTime: number;
    let animationFrame: number;
    const startValue = 0; // Siempre empieza de 0 para el efecto "conteo"

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);

      // Easing function: EaseOutQuart para que frene suave al final
      const easeOut = 1 - Math.pow(1 - progress, 4);

      const current = startValue + (value - startValue) * easeOut;
      setDisplayValue(current);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrame);
  }, [value, duration, isHidden]);

  if (isHidden) {
    return <Text {...textProps}>••••••</Text>;
  }

  return <Text {...textProps}>{formatCurrency(displayValue)}</Text>;
};
