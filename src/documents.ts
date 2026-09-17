// Attaching files: hash → duplicate check → compress → create doc row → upload (now or when online).
import { DEMO } from './config';
import { store, uuid } from './db/store';
import { idb } from './db/idb';
import { driveFolder, hasValidToken, uploadToDrive } from './drive';
import { compressImage, extFor, safeName, sha256 } from './files';
import type { Doc, DocType, EntityType } from './types';

export interface AttachTarget { entity_type: EntityType; entity_id: string; }

export interface PreparedFile {
  original: File | Blob;
  blob: Blob;
  hash: string;
  duplicate: Doc | undefined;
}

export async function prepareFile(file: File | Blob): Promise<PreparedFile> {
  const hash = await sha256(file);
  const duplicate = store.all('documents').find((d) => d.sha256 === hash);
  const blob = await compressImage(file);
  return { original: file, blob, hash, duplicate };
}

export function buildFileName(o: { date: string | null; vendor?: string | null; type: DocType; amount?: number | null; mime: string; original?: string }) {
  const parts = [o.date ?? new Date().toISOString().slice(0, 10), safeName(o.vendor || 'بدون-جهة'), o.type];
  if (o.amount) parts.push(String(o.amount / 1000));
  return `${parts.join('_')}.${extFor(o.mime, o.original)}`;
}

export interface SaveDocInput {
  prepared: PreparedFile;
  type: DocType;
  title: string;
  date: string | null;
  amount?: number | null;
  vendorName?: string | null;
  links: AttachTarget[];
}

/** Creates the document row + links right away; the Drive upload is queued and flushed. */
export async function saveDocument(input: SaveDocInput): Promise<Doc> {
  const { prepared } = input;
  const mime = prepared.blob.type || 'application/octet-stream';
  const fileName = buildFileName({
    date: input.date, vendor: input.vendorName, type: input.type, amount: input.amount, mime,
    original: (prepared.original as File).name,
  });
  const docId = uuid();
  const db = await idb();
  await db.put('blobs', prepared.blob, docId); // local preview + demo storage
  const doc = store.save('documents', {
    id: docId, type: input.type, title: input.title, date: input.date, amount: input.amount ?? null,
    drive_file_id: DEMO ? `local:${docId}` : null, drive_url: null,
    file_name: fileName, mime, size: prepared.blob.size, sha256: prepared.hash,
  });
  for (const l of input.links) linkDocument(doc.id, l);
  if (!DEMO) {
    await db.put('uploads', { docId, blob: prepared.blob, fileName, mime });
    void flushUploads();
  }
  return doc;
}

export function linkDocument(documentId: string, target: AttachTarget) {
  const exists = store.all('document_links').some((l) =>
    l.document_id === documentId && l.entity_type === target.entity_type && l.entity_id === target.entity_id);
  if (!exists) store.save('document_links', { document_id: documentId, ...target });
}

export function unlinkDocument(linkId: string) {
  store.softDelete('document_links', linkId);
}

let uploading = false;
export let uploadError: string | null = null;

export async function pendingUploadCount(): Promise<number> {
  return (await idb()).count('uploads');
}

export async function flushUploads(interactive = false): Promise<void> {
  if (DEMO || uploading || !navigator.onLine) return;
  if (!driveFolder()) { uploadError = 'اختر مجلد Google Drive من الإعدادات لرفع الملفات'; store.emit(); return; }
  if (!interactive && !hasValidToken()) {
    const n = await pendingUploadCount();
    uploadError = n ? 'سجّل الدخول إلى Google لرفع الملفات المعلّقة' : null;
    store.emit();
    return;
  }
  uploading = true;
  const db = await idb();
  try {
    for (const up of await db.getAll('uploads')) {
      const doc = store.get('documents', up.docId);
      if (!doc) { await db.delete('uploads', up.docId); continue; }
      const res = await uploadToDrive(up.blob, up.fileName, up.mime);
      store.save('documents', { id: doc.id, drive_file_id: res.id, drive_url: res.webViewLink });
      await db.delete('uploads', up.docId);
      await db.delete('blobs', up.docId);
    }
    uploadError = null;
  } catch (e) {
    uploadError = (e as Error).message;
  } finally {
    uploading = false;
    store.emit();
  }
}

export async function localBlob(docId: string): Promise<Blob | undefined> {
  return (await idb()).get('blobs', docId);
}

store.onFlush(() => flushUploads());
