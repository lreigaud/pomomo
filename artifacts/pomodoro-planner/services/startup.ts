export const STARTUP_WAIT_MS = 8000;
export const startupStartedAt = Date.now();

/** Bound a native request without allowing its late result to replace state. */
export function withStartupDeadline<T>(
  request: Promise<T>,
  message: string,
  waitMs = STARTUP_WAIT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), waitMs);
    request.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error) => { clearTimeout(timeout); reject(error); },
    );
  });
}

type SplashApi = {
  preventAutoHideAsync: () => Promise<unknown>;
  hideAsync: () => Promise<void>;
  hide: () => void;
};

export async function holdSplashSafely(api: SplashApi): Promise<void> {
  try {
    await withStartupDeadline(api.preventAutoHideAsync(), 'Splash preparation timed out.', 1000);
  } catch {
    console.warn('[Startup] Native splash preparation unavailable; using the app loading screen.');
  }
}

export async function hideSplashSafely(api: SplashApi): Promise<boolean> {
  try {
    await withStartupDeadline(api.hideAsync(), 'Splash dismissal timed out.', 1000);
    return true;
  } catch {
    // Expo also exposes a synchronous hide. Use it when the async bridge fails
    // or never settles, without letting a rejected promise crash startup.
    try {
      api.hide();
      return true;
    } catch {
      console.warn('[Startup] Could not dismiss the native splash screen.');
      return false;
    }
  }
}
