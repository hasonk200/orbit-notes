import { fb } from './firebase';

/** Root URL of the Orbit AI service (MCP + REST), or null when this build has none. */
function readService() {
  const setting = import.meta.env.VITE_ORBIT_AI_URL;
  if (!setting) return null;
  try {
    const url = new URL(setting);
    const dev = import.meta.env.DEV && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    return (url.protocol === 'https:' || dev) && !url.username && !url.password &&
      url.pathname === '/' && !url.search && !url.hash ? url.origin : null;
  } catch {
    return null;
  }
}
export const aiService = readService();

/** Call the signed-in account's management endpoints on the AI service. */
export async function manage<T>(account: string, path: string, options: RequestInit = {}): Promise<T> {
  const user = fb().auth.currentUser;
  if (!user || user.uid !== account) throw new Error('Sign in to Orbit first.');
  const token = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch(aiService + '/manage' + path, {
      ...options, headers: { Authorization: 'Bearer ' + token, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch {
    throw new Error('Could not reach the Orbit AI service.');
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? 'Orbit could not complete this request.');
  return data as T;
}

/** What the AI client asked for, as the consent screen shows it. */
export type ConsentRequest = { name: string; canWrite: boolean; destination: string };
export type ConsentChoice = 'read' | 'write' | 'deny';

/** The authorization request id carried in the page hash (#ai_request=…), if any. */
export const readConsentRequestId = () =>
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.hash.slice(1)).get('ai_request');
