import { useEffect, useState } from 'react';
import { db, uid, type BlobRec } from './schema';

const MAX_DIM = 1920;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
}

/** Resize to max 1920px and re-encode as WebP (JPEG fallback). GIF/SVG are stored as-is. */
export async function compressImage(file: Blob): Promise<{ blob: Blob; width?: number; height?: number }> {
  if (/gif|svg/.test(file.type)) return { blob: file };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    let out = await canvasToBlob(canvas, 'image/webp', 0.85);
    if (!out || out.type !== 'image/webp') out = await canvasToBlob(canvas, 'image/jpeg', 0.85);
    if (!out) return { blob: file };
    if (scale === 1 && out.size > file.size) return { blob: file, width: w, height: h };
    return { blob: out, width: w, height: h };
  } catch {
    return { blob: file };
  }
}

export async function saveImage(file: Blob): Promise<string> {
  const { blob, width, height } = await compressImage(file);
  const rec: BlobRec = {
    id: uid(),
    mimeType: blob.type || 'application/octet-stream',
    data: blob,
    size: blob.size,
    width,
    height,
    createdAt: Date.now(),
  };
  await db.blobs.add(rec);
  return rec.id;
}

const urlCache = new Map<string, string>();

export function useBlobUrl(blobId?: string | null) {
  const [url, setUrl] = useState<string | null>(blobId ? urlCache.get(blobId) ?? null : null);
  useEffect(() => {
    let alive = true;
    if (!blobId) {
      setUrl(null);
      return;
    }
    const cached = urlCache.get(blobId);
    if (cached) {
      setUrl(cached);
      return;
    }
    db.blobs.get(blobId).then((rec) => {
      if (!alive || !rec) return;
      const u = URL.createObjectURL(rec.data);
      urlCache.set(blobId, u);
      setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [blobId]);
  return url;
}

export function extForMime(mime: string) {
  const map: Record<string, string> = {
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
  };
  return map[mime] ?? 'bin';
}
