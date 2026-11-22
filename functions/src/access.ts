import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { InvalidClientMetadataError, InvalidGrantError, InvalidRequestError, InvalidScopeError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { account, ApiError, READ, WRITE, type Actor } from './notes';

const ACCESS_SECONDS = 3600;
const DAY = 86_400_000;
const secret = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const opaque = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);
const clientId = (value: string) => /^[\da-f-]{36}$/i.test(value);

type Pending = {
  clientId: string; name: string; redirectUri: string; state: string | null;
  challenge: string; scopes: string[]; expiresAt: number; expireAt: Timestamp;
};
type Code = {
  uid: string; clientId: string; name: string; scopes: string[];
  redirectUri: string; challenge: string; expiresAt: number; expireAt: Timestamp;
};
type Grant = {
  id: string; name: string; clientId: string; kind: 'api' | 'mcp'; scopes: string[];
  createdAt: number; expiresAt: number; revokedAt: number | null;
};
type Token = {
  uid: string; grantId: string; clientId: string; scopes: string[];
  kind: 'access' | 'refresh'; resource: string; expiresAt: number; expireAt: Timestamp;
};

export function createAccess(db: Firestore, options: { appUrl: URL; issuer: URL; resource: URL; apiResource: URL; redirectUris: readonly string[] }) {
  const { appUrl, issuer, resource, apiResource, redirectUris } = options;
  const requests = db.collection('orbitAiRequests');
  const codes = db.collection('orbitAiCodes');
  const clients = db.collection('orbitAiClients');
  const tokens = db.collection('orbitAiTokens');
  const grants = (uid: string) => account(db, uid).collection('grants');

  function checkResource(value?: URL) {
    if (value && value.href !== resource.href) throw new InvalidRequestError('Unknown Orbit resource.');
  }

  function checkScopes(scopes: string[] | undefined, allowed: string[]) {
    if (scopes?.some((scope) => !allowed.includes(scope))) throw new InvalidScopeError('The requested Orbit scope is unavailable.');
  }

  function storeToken(tx: Transaction, value: string, data: Omit<Token, 'expireAt'>) {
    tx.create(tokens.doc(digest(value)), { ...data, expireAt: Timestamp.fromMillis(data.expiresAt) });
  }

  function issuePair(tx: Transaction, grant: Grant, uid: string, scopes: string[]): OAuthTokens {
    const accessToken = secret();
    const refreshToken = secret();
    const now = Date.now();
    const duration = Math.max(0, Math.min(ACCESS_SECONDS, Math.floor((grant.expiresAt - now) / 1000)));
    if (!duration) throw new InvalidGrantError('The Orbit connection has expired.');
    const common = { uid, clientId: grant.clientId, grantId: grant.id, resource: resource.href, scopes };
    storeToken(tx, accessToken, { ...common, kind: 'access', expiresAt: now + duration * 1000 });
    storeToken(tx, refreshToken, { ...common, kind: 'refresh', expiresAt: grant.expiresAt });
    return { token_type: 'Bearer', access_token: accessToken, expires_in: duration, refresh_token: refreshToken, scope: scopes.join(' ') };
  }

  async function getCode(id: string, client: string) {
    if (!opaque(id)) throw new InvalidGrantError('Invalid authorization code.');
    const code = (await codes.doc(digest(id)).get()).data() as Code | undefined;
    if (!code || code.clientId !== client || code.expiresAt <= Date.now()) throw new InvalidGrantError('Invalid or expired authorization code.');
    return code;
  }

  const provider: OAuthServerProvider = {
    clientsStore: {
      async getClient(id) {
        if (!clientId(id)) return;
        return (await clients.doc(id).get()).data() as OAuthClientInformationFull | undefined;
      },
      async registerClient(client) {
        if (!client.redirect_uris.length || client.redirect_uris.length > 5 ||
          client.redirect_uris.some((url) => !redirectUris.includes(url))) {
          throw new InvalidClientMetadataError('Orbit has not enabled this callback URL.');
        }
        const method = client.token_endpoint_auth_method ?? 'none';
        if (method !== 'none' && method !== 'client_secret_post') throw new InvalidClientMetadataError('Use none or client_secret_post.');
        if (method !== 'none' && !client.client_secret) throw new InvalidClientMetadataError('Missing client secret.');
        const registered = {
          client_id: randomUUID(),
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_name: client.client_name?.trim().slice(0, 100) || 'MCP client',
          redirect_uris: client.redirect_uris,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: method,
          ...(method === 'client_secret_post' ? { client_secret: client.client_secret, client_secret_expires_at: client.client_secret_expires_at ?? 0 } : {}),
        } satisfies OAuthClientInformationFull;
        await clients.doc(registered.client_id).create(registered);
        return registered;
      },
    },
    async authorize(client, params, res) {
      checkResource(params.resource);
      if (!opaque(params.codeChallenge) || params.state && params.state.length > 2000) throw new InvalidRequestError('Invalid authorization parameters.');
      if (!redirectUris.includes(params.redirectUri)) throw new InvalidRequestError('The registered callback is no longer enabled.');
      const requested = params.scopes?.filter(Boolean) ?? [];
      checkScopes(requested, [READ, WRITE]);
      const scopes = requested.length ? [...new Set([READ, ...requested])] : [READ, WRITE];
      const id = secret();
      const expiresAt = Date.now() + 10 * 60_000;
      const data: Pending = {
        clientId: client.client_id, name: client.client_name ?? 'MCP client',
        redirectUri: params.redirectUri, state: params.state ?? null, challenge: params.codeChallenge,
        scopes, expiresAt, expireAt: Timestamp.fromMillis(expiresAt),
      };
      await requests.doc(digest(id)).create(data);
      const url = new URL(appUrl);
      url.hash = new URLSearchParams({ ai_request: id }).toString();
      res.redirect(302, url.href);
    },
    async challengeForAuthorizationCode(client, value) {
      return (await getCode(value, client.client_id)).challenge;
    },
    async exchangeAuthorizationCode(client, value, _verifier, redirectUri, requestedResource) {
      checkResource(requestedResource);
      if (!opaque(value)) throw new InvalidGrantError('Invalid authorization code.');
      const ref = codes.doc(digest(value));
      return db.runTransaction(async (tx) => {
        const code = (await tx.get(ref)).data() as Code | undefined;
        if (!code || code.expiresAt <= Date.now() || code.clientId !== client.client_id || code.redirectUri !== redirectUri) {
          throw new InvalidGrantError('Invalid, expired or previously used authorization code.');
        }
        const now = Date.now();
        const grant: Grant = {
          id: randomUUID(), name: code.name, clientId: client.client_id, kind: 'mcp', scopes: code.scopes,
          createdAt: now, expiresAt: now + 90 * DAY, revokedAt: null,
        };
        tx.delete(ref);
        tx.create(grants(code.uid).doc(grant.id), grant);
        return issuePair(tx, grant, code.uid, grant.scopes);
      });
    },
    async exchangeRefreshToken(client, value, scopes, requestedResource) {
      checkResource(requestedResource);
      if (!opaque(value)) throw new InvalidGrantError('Invalid refresh token.');
      const ref = tokens.doc(digest(value));
      return db.runTransaction(async (tx) => {
        const token = (await tx.get(ref)).data() as Token | undefined;
        if (!token || token.kind !== 'refresh' || token.expiresAt <= Date.now() ||
          token.clientId !== client.client_id || token.resource !== resource.href) throw new InvalidGrantError('Invalid or expired refresh token.');
        const grant = (await tx.get(grants(token.uid).doc(token.grantId))).data() as Grant | undefined;
        if (!grant || grant.revokedAt || grant.expiresAt <= Date.now()) throw new InvalidGrantError('The Orbit connection was revoked or expired.');
        checkScopes(scopes, token.scopes);
        tx.delete(ref);
        return issuePair(tx, grant, token.uid, scopes ?? token.scopes);
      });
    },
    async verifyAccessToken(value) {
      if (!opaque(value)) throw new InvalidTokenError('Invalid Orbit credential.');
      const token = (await tokens.doc(digest(value)).get()).data() as Token | undefined;
      if (!token || token.kind !== 'access' || token.expiresAt <= Date.now()) throw new InvalidTokenError('The Orbit credential is invalid or has expired.');
      const grant = (await grants(token.uid).doc(token.grantId).get()).data() as Grant | undefined;
      if (!grant || grant.revokedAt || grant.expiresAt <= Date.now() || grant.clientId !== token.clientId) throw new InvalidTokenError('The Orbit connection is unavailable.');
      const scopes = token.scopes.filter((scope) => grant.scopes.includes(scope));
      const actor: Actor = { uid: token.uid, grantId: grant.id, scopes, name: grant.name };
      return {
        token: value, clientId: token.clientId, scopes,
        expiresAt: Math.floor(token.expiresAt / 1000), resource: new URL(token.resource), extra: actor,
      };
    },
    async revokeToken(client, request) {
      if (!opaque(request.token)) return;
      const token = (await tokens.doc(digest(request.token)).get()).data() as Token | undefined;
      if (token?.clientId === client.client_id) await revoke(token.uid, token.grantId);
    },
  };

  async function pending(id: string) {
    if (!opaque(id)) throw new ApiError(404, 'Authorization request not found.');
    const data = (await requests.doc(digest(id)).get()).data() as Pending | undefined;
    if (!data || data.expiresAt <= Date.now()) throw new ApiError(404, 'This authorization request has expired.');
    return { name: data.name, canWrite: data.scopes.includes(WRITE), destination: new URL(data.redirectUri).host };
  }

  async function finish(uid: string, id: string, choice: 'read' | 'write' | 'deny') {
    if (!opaque(id)) throw new ApiError(404, 'Authorization request not found.');
    const ref = requests.doc(digest(id));
    const codeId = secret();
    return db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data() as Pending | undefined;
      if (!data || data.expiresAt <= Date.now()) throw new ApiError(404, 'This authorization request has expired.');
      if (!redirectUris.includes(data.redirectUri)) throw new ApiError(400, 'This callback is no longer enabled.');
      if (choice === 'write' && !data.scopes.includes(WRITE)) throw new ApiError(400, 'This client requested read-only access.');
      const callback = new URL(data.redirectUri);
      if (data.state !== null) callback.searchParams.set('state', data.state);
      if (choice === 'deny') {
        callback.searchParams.set('error', 'access_denied');
      } else {
        const expiresAt = Date.now() + 2 * 60_000;
        const code: Code = {
          uid, clientId: data.clientId, name: data.name, scopes: choice === 'write' ? [READ, WRITE] : [READ],
          challenge: data.challenge, redirectUri: data.redirectUri, expiresAt, expireAt: Timestamp.fromMillis(expiresAt),
        };
        tx.create(codes.doc(digest(codeId)), code);
        callback.searchParams.set('code', codeId);
      }
      callback.searchParams.set('iss', issuer.href);
      tx.delete(ref);
      return { redirect: callback.href };
    });
  }

  async function createApiToken(uid: string, name: string, write: boolean) {
    const id = randomUUID();
    const token = secret();
    const now = Date.now();
    const grant: Grant = {
      id, name, clientId: id, kind: 'api', scopes: write ? [READ, WRITE] : [READ],
      createdAt: now, expiresAt: now + 30 * DAY, revokedAt: null,
    };
    await db.runTransaction(async (tx) => {
      tx.create(grants(uid).doc(id), grant);
      storeToken(tx, token, { uid, clientId: id, grantId: id, scopes: grant.scopes, kind: 'access',
        resource: apiResource.href, expiresAt: grant.expiresAt });
    });
    return { token, expiresAt: grant.expiresAt };
  }

  async function list(uid: string) {
    const records = await grants(uid).orderBy('createdAt', 'desc').get();
    return { grants: records.docs.map((doc) => doc.data() as Grant) };
  }

  async function revoke(uid: string, id: string) {
    if (!clientId(id)) throw new ApiError(404, 'Connection not found.');
    const ref = grants(uid).doc(id);
    await db.runTransaction(async (tx) => {
      const grant = (await tx.get(ref)).data() as Grant | undefined;
      if (!grant) throw new ApiError(404, 'Connection not found.');
      if (!grant.revokedAt) tx.update(ref, { revokedAt: Date.now() });
    });
  }

  return { provider, pending, finish, createApiToken, list, revoke };
}
