/**
 * @file core/auth/useResendCooldown.ts
 * @description Thin React wrapper over `resendCooldown.logic`: owns the 1 s
 * ticker and exposes the remaining seconds. All decisions live in the logic file.
 */

import { useCallback, useEffect, useState } from 'react';

import { cooldownEndsAt, remainingSeconds } from './resendCooldown.logic';

export const useResendCooldown = (now: () => number = Date.now) => {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (endsAt === null) return;
    const tick = () => {
      const left = remainingSeconds(endsAt, now());
      setSeconds(left);
      if (left === 0) setEndsAt(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt, now]);

  const start = useCallback(() => setEndsAt(cooldownEndsAt(now())), [now]);

  return { seconds, start };
};
