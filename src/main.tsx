import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ensureSeed } from './db/seed';
import { startDataSync } from './store/dataStore';
import { applyTheme, getT, useUI } from './store/uiStore';
import { autoBackupIfDue } from './db/fsSync';
import { upgradeTaskIndex } from './db/indexers';
import { initSync } from './sync/engine';
import { initPwa } from './lib/pwa';
import { initNative } from './lib/native';
import './styles/tokens.css';
import './styles/app.css';
import './styles/motion.css';

applyTheme(useUI.getState().theme);
initNative();
initPwa();
document.documentElement.lang = getT().language;

const basePath = import.meta.env.BASE_URL;
if (window.location.pathname === basePath && new URLSearchParams(window.location.hash.slice(1)).has('ai_request')) {
  window.history.replaceState(window.history.state, '', basePath + 'settings' + window.location.hash);
}

let splashDismissed = false;
function dismissSplash() {
  if (splashDismissed || typeof document === 'undefined') return;
  splashDismissed = true;
  const splash = document.getElementById('orbit-splash');
  if (!splash) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const start = (window as { __ORBIT_SPLASH_START__?: number }).__ORBIT_SPLASH_START__ ?? performance.now();
  const wait = reduced ? 0 : Math.max(0, 720 - (performance.now() - start));
  window.setTimeout(() => {
    const rootEl = document.getElementById('root');
    if (rootEl && !reduced) {
      rootEl.classList.add('orbit-app-reveal');
      window.setTimeout(() => rootEl.classList.remove('orbit-app-reveal'), 480);
    }
    splash.classList.add('is-leaving');
    window.setTimeout(() => {
      splash.remove();
      document.getElementById('orbit-splash-style')?.remove();
    }, reduced ? 20 : 420);
  }, wait);
}
window.setTimeout(dismissSplash, 3500);

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
