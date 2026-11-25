/** Home-screen app support: service worker, install prompt and update notice. */
import { create } from 'zustand';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  canInstall: boolean; // the browser offers its own install prompt (Chrome, Edge, Android)
  installed: boolean; // running as an installed app
  updateReady: boolean; // a newer version was downloaded and takes over on reload
}

const standalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);

export const usePwa = create<PwaState>(() => ({ canInstall: false, installed: standalone(), updateReady: false }));

let deferred: InstallPromptEvent | null = null;

export const isIos = () => typeof navigator !== 'undefined' && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export async function promptInstall() {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  usePwa.setState({ canInstall: false });
  return outcome === 'accepted';
}

export function reloadForUpdate() {
  window.location.reload();
}

/** The built script of the version running now (production builds only). */
function runningScript() {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return el ? new URL(el.src, window.location.href).pathname : null;
}

/**
 * Is a newer Orbit online than the one running? Pages are served network-first, so a reload
 * picks the new version up; this only tells whether that reload is worth doing. It compares
 * the hashed script name in the live index.html with the running one.
 */
export async function isNewVersionOnline(): Promise<boolean> {
  if (!import.meta.env.PROD) return false;
  try {
    const response = await fetch(import.meta.env.BASE_URL, { cache: 'no-store' });
    if (!response.ok) return false;
    const html = await response.text();
    const src = html.match(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/)?.[1];
    const now = runningScript();
    return !!src && !!now && new URL(src, window.location.href).pathname !== now;
  } catch {
    return false;
  }
}

/** Keep the browser/status bar colour in step with Orbit's own light/dark setting. */
export function syncThemeColor() {
  const bg = getComputedStyle(document.body).backgroundColor || getComputedStyle(document.documentElement).getPropertyValue('--bg');
  if (!bg) return;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = bg.trim();
  document.head.appendChild(meta);
}

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    usePwa.setState({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    usePwa.setState({ canInstall: false, installed: true });
  });
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => usePwa.setState({ installed: standalone() }));

  new MutationObserver(syncThemeColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', syncThemeColor);
  syncThemeColor();

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A newer version took over. Only mention it if an older one was running.
    if (hadController) usePwa.setState({ updateReady: true });
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        // Look for a new version when the app comes back to the foreground.
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void reg.update().catch(() => undefined));
      })
      .catch((err) => console.warn('Orbit: offline support is unavailable', err));
  });
}
