import { flushAllDrafts } from '../db/drafts';
import { isNewVersionOnline, usePwa } from '../lib/pwa';
import { create } from 'zustand';
import { syncNow, useSync } from '../sync/engine';

/**
 * "Pull to refresh" for Orbit: load a newer version if one is online (saving open edits first),
 * otherwise sync with the cloud right away. Returns 'reloading' when the page is about to reload.
 */
export async function refreshOrbit(): Promise<'reloading' | 'synced'> {
  if (usePwa.getState().updateReady || (await isNewVersionOnline())) {
    await flushAllDrafts();
    window.location.reload();
    return 'reloading';
  }
  await syncNow().catch((e) => console.warn('Orbit: sync on refresh failed', e));
  return 'synced';
}


type RefreshState = { busy: boolean; note: 'updating' | 'synced' | 'latest' | null };

/** Shared by the Orbit button on Home and the Home tab, so both show the same progress. */
export const useRefresh = create<RefreshState>(() => ({ busy: false, note: null }));

let clearNote = 0;

/** Scroll Home back to the top and refresh, like tapping a logo or the active tab in other apps. */
export async function refreshFromHome() {
  document.querySelector('.pane-main .pane-body')?.scrollTo({ top: 0, behavior: 'smooth' });
  if (useRefresh.getState().busy) return;
  window.clearTimeout(clearNote);
  useRefresh.setState({ busy: true, note: null });
  const signedIn = !!useSync.getState().user;
  const result = await refreshOrbit();
  if (result === 'reloading') return useRefresh.setState({ busy: true, note: 'updating' });
  useRefresh.setState({ busy: false, note: signedIn ? 'synced' : 'latest' });
  clearNote = window.setTimeout(() => useRefresh.setState({ note: null }), 2600);
}
