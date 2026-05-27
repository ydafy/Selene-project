import { useState, useEffect } from 'react';

interface CountdownResult {
  timeLeft: string; // Formato "47h 59m" o "00h 00m"
  isExpired: boolean;
  hoursRemaining: number;
}

export const useOrderCountdown = (
  startTimeString?: string | null,
  hoursLimit: number = 48,
): CountdownResult => {
  const [timeLeft, setTimeLeft] = useState<string>('--h --m');
  const [isExpired, setIsExpired] = useState<boolean>(false);
  const [hoursRemaining, setHoursRemaining] = useState<number>(hoursLimit);

  useEffect(() => {
    if (!startTimeString) return;

    const startTime = new Date(startTimeString).getTime();
    if (isNaN(startTime)) return;
    const endTime = startTime + hoursLimit * 60 * 60 * 1000;

    const calculateTime = () => {
      const now = new Date().getTime();
      const distance = endTime - now;

      if (distance <= 0) {
        setIsExpired(true);
        setTimeLeft('00h 00m');
        setHoursRemaining(0);
        return;
      }

      const hours = Math.floor(distance / (1000 * 60 * 60));
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));

      setTimeLeft(
        `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m`,
      );
      setHoursRemaining(hours);
      setIsExpired(false);
    };

    // Calcular inmediatamente
    calculateTime();

    // Actualizar cada minuto (no necesitamos precisión de segundos para 48h)
    const interval = setInterval(calculateTime, 60000);

    return () => clearInterval(interval);
  }, [startTimeString, hoursLimit]);

  return { timeLeft, isExpired, hoursRemaining };
};
