import { getMeta, setMeta } from './schema';
import { backupFileName, buildBackupZip } from './backup';

export const fsSupported = () => typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function';

export async function chooseBackupFolder() {
  const handle = await (window as any).showDirectoryPicker({ id: 'orbit-backup', mode: 'readwrite' });
  await setMeta('backupDirHandle', handle);
  return handle as FileSystemDirectoryHandle;
}

export async function getBackupFolder(): Promise<any | undefined> {
  return getMeta('backupDirHandle');
}

export async function forgetBackupFolder() {
  await setMeta('backupDirHandle', null);
}

async function ensurePermission(handle: any, ask: boolean) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  if (!ask) return false;
  return (await handle.requestPermission?.(opts)) === 'granted';
}

const KEEP = 14;

/** Write a dated zip into the chosen folder and keep the newest 14. `ask` = may show the permission prompt. */
export async function backupToFolder(ask = true): Promise<string | null> {
  const handle = await getBackupFolder();
  if (!handle) return null;
  if (!(await ensurePermission(handle, ask))) return null;
  const blob = await buildBackupZip();
  const name = backupFileName();
  const fh = await handle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
  await setMeta('lastBackupAt', Date.now());
  try {
    const names: string[] = [];
    for await (const [n, h] of handle.entries()) {
      if (h.kind === 'file' && /^orbit-backup-.*\.zip$/.test(n)) names.push(n);
    }
    names.sort().reverse();
    for (const n of names.slice(KEEP)) await handle.removeEntry(n);
  } catch {
    /* rotation is best-effort */
  }
  return name;
}

/** On app start: quiet daily backup if a folder is set and permission is still granted. */
export async function autoBackupIfDue() {
  try {
    const handle = await getBackupFolder();
    if (!handle) return;
    const last = (await getMeta<number>('lastBackupAt')) ?? 0;
    if (Date.now() - last < 24 * 3600 * 1000) return;
    await backupToFolder(false);
  } catch {
    /* ignore */
  }
}
