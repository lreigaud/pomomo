import { useEffect, useState } from 'react';
import { STARTUP_WAIT_MS, startupStartedAt } from '@/services/startup';

export function useStartupFonts(fontsLoaded: boolean, fontError: Error | null) {
  const [timedOut, setTimedOut] = useState(
    () => Date.now() - startupStartedAt >= STARTUP_WAIT_MS,
  );
  useEffect(() => {
    if (fontsLoaded || fontError || timedOut) return;
    const remaining = Math.max(0, STARTUP_WAIT_MS - (Date.now() - startupStartedAt));
    const timeout = setTimeout(() => setTimedOut(true), remaining);
    return () => clearTimeout(timeout);
  }, [fontsLoaded, fontError, timedOut]);
  return { pending: !fontsLoaded && !fontError && !timedOut, timedOut };
}
