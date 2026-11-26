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

/** Reveal the hidden Tauri desktop window after the initial themed splash frame paints. */
export async function showDesktopWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('show_main_window');
  } catch {
    /* ignore if already shown or running outside Tauri */
  }
}

/** Complete Google sign-in via the user's real browser + 1-shot localhost loopback callback. */
export async function desktopGoogleSignIn(webAppUrl: string): Promise<string> {
  if (!isTauri()) throw new Error('Desktop sign-in is only available in the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('desktop_google_sign_in', { webAppUrl });
}

/** Drain any local Markdown file paths passed on cold start before UI listeners mounted. */
export async function takePendingLocalFiles(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string[]>('take_pending_files');
  } catch {
    return [];
  }
}

/** Listen for local Markdown file open events forwarded from Windows "Open with" while running. */
export async function onOpenLocalFile(cb: (path: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<string>('orbit://open-file', (event) => {
    if (event.payload) cb(event.payload);
  });
}

/** Read a local Markdown file from disk inside Tauri Desktop. */
export async function readLocalMarkdown(path: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('read_local_markdown', { path });
}

/** Write updated Markdown text back to a local file on disk inside Tauri Desktop. */
export async function writeLocalMarkdown(path: string, content: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('write_local_markdown', { path, content });
}

/** Validate loopback port + CSRF state parameters for /desktop-auth. */
export function parseDesktopAuthParams(search: string): { port: number; state: string } | null {
  const params = new URLSearchParams(search);
  const rawPort = params.get('port') ?? '';
  const state = params.get('state') ?? '';
  if (!/^\d{4,5}$/.test(rawPort)) return null;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  if (!/^[a-f0-9]{16,128}$/i.test(state)) return null;
  return { port, state };
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
