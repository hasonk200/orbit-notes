/**
 * Ask the editor of a note to jump to (and zoom into) a block once it is open.
 * Used by live searches and tag pages to land on the exact tagged item.
 */
const pending = new Map<string, number[]>();
const EVENT = 'orbit-jump';

export function requestJump(objectId: string, path: number[]) {
  pending.set(objectId, path);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: objectId }));
}

export function takeJump(objectId: string) {
  const path = pending.get(objectId);
  pending.delete(objectId);
  return path;
}

export function onJump(fn: (objectId: string) => void) {
  const handler = (e: Event) => fn((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
