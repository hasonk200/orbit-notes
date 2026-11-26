import { objPath } from '../store/pane';
import { isNativeApp, WEB_APP_URL } from '../lib/native';

/**
 * A shareable address for a note. The desktop and phone apps run from an internal address
 * (tauri://…, https://localhost), so they point at the Orbit website instead.
 */
export function noteWebUrl(id: string, native = isNativeApp(), origin = window.location.origin, base = import.meta.env.BASE_URL) {
  if (native) return WEB_APP_URL + objPath(id);
  return new URL(base.replace(/\/$/, '') + objPath(id), origin).href;
}

/** Copy a shareable address for a note in this Orbit (it opens the note in the app). */
export async function copyObjectLink(id: string) {
  const url = noteWebUrl(id);
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    window.prompt('', url);
    return false;
  }
}
