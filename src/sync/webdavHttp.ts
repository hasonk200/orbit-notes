/**
 * Plain HTTP for WebDAV, through whatever the platform allows.
 * Nutstore (坚果云) and most WebDAV servers don't allow requests from web pages (CORS), so the desktop
 * app uses Tauri's native HTTP and the phone app uses Capacitor's. The web app uses fetch, which only
 * works with servers that allow it.
 */
import { isCapacitor, isTauri } from '../lib/native';

export interface DavResponse {
  status: number;
  etag: string | null;
  text: string;
}

export interface DavRequest {
  method: 'GET' | 'PUT' | 'MKCOL' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export type DavTransport = (req: DavRequest) => Promise<DavResponse>;

/** Native requests bypass the browser's CORS rule; the web app can't. */
export const nativeHttpAvailable = () => isTauri() || isCapacitor();

function header(headers: Record<string, string> | Headers, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  const hit = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return hit ? headers[hit] : null;
}

const fetchTransport = (impl: typeof fetch): DavTransport => async ({ method, url, headers, body }) => {
  const res = await impl(url, { method, headers, body, cache: 'no-store' });
  return { status: res.status, etag: header(res.headers, 'etag'), text: method === 'GET' && res.status === 200 ? await res.text() : '' };
};

const capacitorTransport: DavTransport = async ({ method, url, headers, body }) => {
  const { CapacitorHttp } = await import('@capacitor/core');
  const res = await CapacitorHttp.request({ method, url, headers, data: body, responseType: 'text', connectTimeout: 20000, readTimeout: 60000 });
  const text = typeof res.data === 'string' ? res.data : res.data == null ? '' : JSON.stringify(res.data);
  return { status: res.status, etag: header(res.headers ?? {}, 'etag'), text };
};

export async function platformTransport(): Promise<DavTransport> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return fetchTransport(tauriFetch as typeof fetch);
  }
  if (isCapacitor()) return capacitorTransport;
  return fetchTransport(window.fetch.bind(window));
}

/** HTTP Basic credentials, safe for non-ASCII user names and passwords. */
export function basicAuth(user: string, password: string) {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `Basic ${btoa(bin)}`;
}

/** The sync folder URL, always ending in "/". */
export function folderUrl(server: string, folder: string) {
  const base = server.trim().replace(/\/+$/, '');
  const name = folder.trim().replace(/^\/+|\/+$/g, '');
  return `${base}/${name.split('/').map(encodeURIComponent).join('/')}/`;
}
