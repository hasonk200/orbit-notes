import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ensureSeed } from './db/seed';
import { startDataSync } from './store/dataStore';
import { applySpace, applyTheme, getT, useUI } from './store/uiStore';
import { autoBackupIfDue } from './db/fsSync';
import { upgradeTaskIndex } from './db/indexers';
import { initSync } from './sync/engine';
import { initWebDav } from './sync/webdav';
import { initPwa } from './lib/pwa';
import { initNative, showDesktopWindow } from './lib/native';
import './styles/tokens.css';
import './styles/app.css';
import './styles/motion.css';

applyTheme(useUI.getState().theme);
applySpace(useUI.getState().space);
initNative();
initPwa();
document.documentElement.lang = getT().language;

const basePath = import.meta.env.BASE_URL;
// An AI app asking to connect lands on Orbit's own approval page (the AI service sends it to the app root).
if ([basePath, basePath + 'settings'].includes(window.location.pathname) && new URLSearchParams(window.location.hash.slice(1)).has('ai_request')) {
  window.history.replaceState(window.history.state, '', basePath + 'connect' + window.location.hash);
}

let splashPlayStartedAt: number | null = null;
let splashDismissRequested = false;
let splashDismissed = false;

function runExit() {
  if (splashDismissed || typeof document === 'undefined') return;
  splashDismissed = true;
  const splash = document.getElementById('orbit-splash');
  if (!splash) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const playedFor = splashPlayStartedAt == null ? 0 : performance.now() - splashPlayStartedAt;
  const wait = reduced ? 0 : Math.max(0, 1200 - playedFor);
  window.setTimeout(() => {
    const rootEl = document.getElementById('root');
    if (rootEl && !reduced) {
      rootEl.classList.add('orbit-app-reveal');
      window.setTimeout(() => rootEl.classList.remove('orbit-app-reveal'), 500);
    }
    splash.classList.add('is-leaving');
    window.setTimeout(() => {
      splash.remove();
      document.getElementById('orbit-splash-style')?.remove();
    }, reduced ? 20 : 440);
  }, wait);
}

function dismissSplash() {
  splashDismissRequested = true;
  if (splashPlayStartedAt != null) runExit();
}

async function startSplash() {
  if (typeof document === 'undefined') return;
  await showDesktopWindow();
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const splash = document.getElementById('orbit-splash');
  if (splash) splash.classList.add('is-playing');
  splashPlayStartedAt = performance.now();
  if (splashDismissRequested) runExit();
}

void startSplash();
window.setTimeout(() => {
  if (splashPlayStartedAt == null) splashPlayStartedAt = performance.now();
  runExit();
}, 4500);

async function boot() {
  try {
    await ensureSeed();
  } catch (e) {
    console.error('Orbit: could not open the database', e);
    const message = document.createElement('div');
    message.className = 'boot';
    message.textContent = getT()('Orbit could not open its local database. Private windows or blocked site data can cause this.');
    document.getElementById('root')!.replaceChildren(message);
    dismissSplash();
    return;
  }
  try {
    await upgradeTaskIndex();
  } catch (e) {
    console.error('Orbit: could not refresh the task index', e);
  }
  startDataSync();
  try {
    initSync();
  } catch (e) {
    console.error('Orbit: cloud sync failed to start', e);
  }
  initWebDav().catch((e) => console.error('Orbit: WebDAV sync failed to start', e));
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/[/]$/, '')}>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
  dismissSplash();
  window.setTimeout(() => void autoBackupIfDue(), 4000);
}

void boot();
