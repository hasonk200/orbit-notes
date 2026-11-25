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
// An AI app asking to connect lands on Orbit's own approval page (the AI service sends it to the app root).
if ([basePath, basePath + 'settings'].includes(window.location.pathname) && new URLSearchParams(window.location.hash.slice(1)).has('ai_request')) {
  window.history.replaceState(window.history.state, '', basePath + 'connect' + window.location.hash);
}

async function boot() {
  try {
    await ensureSeed();
  } catch (e) {
    console.error('Orbit: could not open the database', e);
    const message = document.createElement('div');
    message.className = 'boot';
    message.textContent = getT()('Orbit could not open its local database. Private windows or blocked site data can cause this.');
    document.getElementById('root')!.replaceChildren(message);
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
  window.setTimeout(() => void autoBackupIfDue(), 4000);
}

void boot();
