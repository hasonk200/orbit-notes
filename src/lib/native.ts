/** Runtime helpers for native Tauri (desktop) and Capacitor (mobile) shells. */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function isCapacitor(): boolean {
  return typeof window !== 'undefined' && !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
}

export function isNativeApp(): boolean {
  return isTauri() || isCapacitor();
}

/** Open a local file:// URI using the host OS when running inside the Tauri desktop app. */
export async function openLocalFile(url: string): Promise<boolean> {
  if (!isTauri() || !/^file:/i.test(url)) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_local_path', { url });
    return true;
  } catch (err) {
    console.warn('Orbit: could not open local file natively', err);
    return false;
  }
}

/** Open an external http(s)/mailto link in the system browser when inside Tauri or Capacitor. */
export async function openExternalUrl(url: string): Promise<boolean> {
  if (!/^(?:https?|mailto):/i.test(url)) return false;
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_external_url', { url });
      return true;
    } catch (err) {
      console.warn('Orbit: could not open external URL natively', err);
      return false;
    }
  }
  if (isCapacitor()) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return true;
    } catch (err) {
      console.warn('Orbit: could not open browser natively', err);
      return false;
    }
  }
  return false;
}

let initialized = false;

/** Wire native shell hooks (Android back button, external link opening in Tauri). */
export function initNative(): void {
  if (initialized || typeof window === 'undefined' || typeof document === 'undefined') return;
  initialized = true;

  if (isCapacitor()) {
    void import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('backButton', ({ canGoBack }) => {
          if (canGoBack && window.history.length > 1) window.history.back();
          else void App.minimizeApp();
        }),
      )
      .catch(() => undefined);
  }

  if (isTauri()) {
    document.addEventListener(
      'click',
      (event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        const a = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
        if (!a) return;
        const href = a.getAttribute('href') ?? '';
        if (!/^(?:https?|mailto):/i.test(href)) return;
        const isMailto = /^mailto:/i.test(href);
        let external = isMailto || a.target === '_blank';
        if (!external) {
          try {
            external = new URL(href, window.location.href).origin !== window.location.origin;
          } catch {
            external = false;
          }
        }
        if (!external) return;
        event.preventDefault();
        void openExternalUrl(href);
      },
      true,
    );
  }
}
