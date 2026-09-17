export async function sha256(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isImage(mime: string | null | undefined) { return !!mime && mime.startsWith('image/'); }
export function isPdf(mime: string | null | undefined) { return mime === 'application/pdf'; }

/** Downscale photos to max 2000px wide, JPEG q0.8. Non-images are returned unchanged. */
export async function compressImage(file: Blob, maxWidth = 2000, quality = 0.8): Promise<Blob> {
  if (!isImage(file.type) || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, maxWidth / bmp.width);
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function extFor(mime: string, fallbackName = ''): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/heic') return 'heic';
  if (mime === 'application/pdf') return 'pdf';
  const m = fallbackName.match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : 'bin';
}

/** Filesystem-safe but keeps Arabic letters. */
export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|#%{}~&]+/g, '').replace(/\s+/g, '-').slice(0, 60) || 'مستند';
}

export function fmtSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
