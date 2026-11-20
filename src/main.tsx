import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ensureSeed } from './db/seed';
import { startDataSync } from './store/dataStore';
import { applyTheme, useUI } from './store/uiStore';
import { autoBackupIfDue } from './db/fsSync';
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
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
  window.setTimeout(() => void autoBackupIfDue(), 4000);
}

void boot();
