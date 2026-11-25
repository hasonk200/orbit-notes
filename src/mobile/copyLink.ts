import { objPath } from '../store/pane';

/** Copy a shareable address for a note in this Orbit (it opens the note in the app). */
export async function copyObjectLink(id: string) {
  const url = new URL(import.meta.env.BASE_URL.replace(/\/$/, '') + objPath(id), window.location.origin).href;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    window.prompt('', url);
    return false;
  }
}
