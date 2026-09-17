// Google Drive: GIS token flow + Picker + multipart upload, scope drive.file.
import { config, DRIVE_ENABLED, local } from './config';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';

declare global {
  interface Window {
    google?: any;
    gapi?: any;
  }
}

let token: { value: string; exp: number } | null = null;
let tokenClient: any = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`تعذر تحميل ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureGis() {
  await loadScript('https://accounts.google.com/gsi/client');
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId,
      scope: SCOPE,
      callback: () => undefined,
    });
  }
}

/** Get an access token. `interactive` must be true when called from a user tap the first time. */
export async function getToken(interactive = true): Promise<string> {
  if (!DRIVE_ENABLED) throw new Error('Google Drive غير مُعد');
  if (token && token.exp > Date.now() + 60_000) return token.value;
  await ensureGis();
  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp: any) => {
      if (resp.error) return reject(new Error(resp.error_description || resp.error));
      token = { value: resp.access_token, exp: Date.now() + Number(resp.expires_in ?? 3600) * 1000 };
      local.set('driveConnected', '1');
      resolve(token.value);
    };
    tokenClient.error_callback = (err: any) => reject(new Error(err?.message || 'تم إلغاء تسجيل الدخول'));
    tokenClient.requestAccessToken({ prompt: interactive && !local.get('driveConnected') ? 'consent' : '' });
  });
}

export function driveFolder(): { id: string; name: string } | null {
  const id = local.get('driveFolderId');
  return id ? { id, name: local.get('driveFolderName') ?? '' } : null;
}

/** Let the user pick the shared "بناء البيت" folder (grants drive.file access to it). */
export async function pickFolder(): Promise<{ id: string; name: string } | null> {
  const accessToken = await getToken(true);
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise<void>((res) => window.gapi.load('picker', () => res()));
  const g = window.google;
  return new Promise((resolve) => {
    const view = new g.picker.DocsView(g.picker.ViewId.FOLDERS)
      .setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes('application/vnd.google-apps.folder');
    const shared = new g.picker.DocsView(g.picker.ViewId.FOLDERS)
      .setIncludeFolders(true).setSelectFolderEnabled(true).setOwnedByMe(false).setMimeTypes('application/vnd.google-apps.folder');
    const picker = new g.picker.PickerBuilder()
      .setTitle('اختر مجلد بناء البيت')
      .addView(view).addView(shared)
      .setOAuthToken(accessToken)
      .setDeveloperKey(config.googleApiKey)
      .setAppId(config.googleAppId)
      .setLocale('ar')
      .setCallback((data: any) => {
        if (data.action === g.picker.Action.PICKED) {
          const doc = data.docs[0];
          local.set('driveFolderId', doc.id);
          local.set('driveFolderName', doc.name);
          resolve({ id: doc.id, name: doc.name });
        } else if (data.action === g.picker.Action.CANCEL) resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
}

/** Create a new folder in My Drive (first-time setup on Ahmed's account). */
export async function createFolder(name: string): Promise<{ id: string; name: string }> {
  const t = await getToken(true);
  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!res.ok) throw new Error(`Drive: ${res.status}`);
  const f = await res.json();
  local.set('driveFolderId', f.id);
  local.set('driveFolderName', f.name);
  return f;
}

export async function uploadToDrive(blob: Blob, name: string, mime: string): Promise<{ id: string; webViewLink: string }> {
  const folder = driveFolder();
  if (!folder) throw new Error('اختر مجلد Drive من الإعدادات أولاً');
  const t = await getToken(false);
  const boundary = `bina${Date.now()}`;
  const meta = { name, mimeType: mime, parents: [folder.id] };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, blob, `\r\n--${boundary}--`,
  ]);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (res.status === 401) { token = null; throw new Error('انتهت جلسة Google، سجّل الدخول من الإعدادات'); }
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Embeddable preview that works with the user's own Google session (independent of app scope). */
export const drivePreviewUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
export const driveViewUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;

export function hasValidToken(): boolean {
  return !!token && token.exp > Date.now() + 60_000;
}
