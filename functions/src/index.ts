import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { createApp } from './app';

initializeApp();

const serviceUrl = defineString('ORBIT_SERVICE_URL', {
  description: 'Root HTTPS URL of the orbitapi Cloud Run service.',
});
const appUrl = defineString('ORBIT_APP_URL', { default: 'https://hasonk200.github.io/orbit-notes/' });
const callbacks = defineString('ORBIT_AI_REDIRECT_URIS', {
  description: 'Comma-separated exact OAuth callback URLs from the AI clients you want to connect.',
});

let app: ReturnType<typeof createApp> | undefined;
export const orbitApi = onRequest({ region: 'northamerica-northeast2', invoker: 'public', timeoutSeconds: 60 }, (req, res) => {
  app ??= createApp({
    db: getFirestore(),
    auth: getAuth(),
    serviceUrl: serviceUrl.value(),
    appUrl: appUrl.value(),
    redirectUris: callbacks.value().split(',').map((uri) => uri.trim()).filter(Boolean),
  });
  app(req, res);
});
