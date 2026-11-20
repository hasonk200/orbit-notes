import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ensureSeed } from './db/seed';
import { startDataSync } from './store/dataStore';
import { applyTheme, useUI } from './store/uiStore';
import { autoBackupIfDue } from './db/fsSync';
import { initSync } from './sync/engine';
import './styles/tokens.css';
import './styles/app.css';

applyTheme(useUI.getState().theme);

async function boot() {
  try {
    await ensureSeed();
  } catch (e) {
    console.error('Orbit: could not open the database', e);
    document.getElementById('root')!.innerHTML =
      '<div class="boot">Orbit could not open its local database. Private windows or blocked site data can cause this.</div>';
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
