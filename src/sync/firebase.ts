import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, type Auth } from 'firebase/auth';
import { initializeFirestore, type Firestore } from 'firebase/firestore';

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
};

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

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(fb().auth, provider);
}

export async function signOutOfCloud() {
  await signOut(fb().auth);
}
