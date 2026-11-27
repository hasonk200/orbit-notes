/** Cloud sync status, readable without loading the Firebase SDK (it loads after the app is on screen). */
import { create } from 'zustand';
import { firebaseConfigured } from './config';

export type SyncStatus = 'unconfigured' | 'signed-out' | 'connecting' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  user: { uid: string; email: string | null; name: string | null; photo: string | null } | null;
  error: string | null;
  lastSyncAt: number | null;
  skipped: string[]; // keys that could not be uploaded (e.g. images over the size limit)
}

export const useSync = create<SyncState>(() => ({
  status: firebaseConfigured ? 'signed-out' : 'unconfigured',
  user: null,
  error: null,
  lastSyncAt: null,
  skipped: [],
}));
