import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ensureSeed } from './db/seed';
import { startDataSync } from './store/dataStore';
import { applyTheme, getT, useUI } from './store/uiStore';
import { autoBackupIfDue } from './db/fsSync';
import { initSync } from './sync/engine';
import './styles/tokens.css';
import './styles/app.css';

applyTheme(useUI.getState().theme);
document.documentElement.lang = getT().language;

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
