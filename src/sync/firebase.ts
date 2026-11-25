import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithCredential, signInWithPopup, signOut, type Auth } from 'firebase/auth';
import { initializeFirestore, type Firestore } from 'firebase/firestore';
import { isTauri } from '../lib/native';

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
};

const googleClientId = env.VITE_GOOGLE_CLIENT_ID as string | undefined;
export const googleDirectAvailable = !!googleClientId;

export const firebaseConfigured = !!(config.apiKey && config.projectId && config.appId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let fs: Firestore | null = null;

export function fb() {
  if (!firebaseConfigured) throw new Error('Firebase is not configured (.env.local is missing).');
  if (!app) {
    app = initializeApp(config as Record<string, string>);
    auth = getAuth(app);
    fs = initializeFirestore(app, {});
  }
  return { app: app!, auth: auth!, fs: fs! };
}

// ---------- Google Identity Services: Google's own sign-in window, no third-party cookies needed ----------

let gisLoading: Promise<void> | null = null;
function loadGis() {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoading = null;
      reject(new Error('Could not load Google sign-in. Check your connection or ad blocker.'));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

/** Main sign-in: Google's account window, then hand the token to Firebase. */
export async function signInWithGoogle() {
  if (isTauri() || !googleClientId) return signInWithFirebasePopup();
  await loadGis();
  const accessToken = await new Promise<string>((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: googleClientId,
      scope: 'openid email profile',
      prompt: 'select_account',
      callback: (resp: any) =>
        resp?.access_token ? resolve(resp.access_token) : reject(new Error(resp?.error_description || resp?.error || 'Sign-in was cancelled.')),
      error_callback: (err: any) =>
        reject(Object.assign(new Error(err?.message || 'Sign-in window was closed.'), { code: err?.type === 'popup_closed' ? 'auth/popup-closed-by-user' : err?.type })),
    });
    client.requestAccessToken();
  });
  await signInWithCredential(fb().auth, GoogleAuthProvider.credential(null, accessToken));
}

/** Alternative: Firebase's built-in popup (may hang if the browser blocks third-party cookies). */
export async function signInWithFirebasePopup() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(fb().auth, provider);
}

export async function signOutOfCloud() {
  await signOut(fb().auth);
}
