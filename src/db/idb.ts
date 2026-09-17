import { openDB, type IDBPDatabase } from 'idb';

export interface OutboxOp {
  seq?: number;
  table: string;
  rowId: string;
  kind: 'insert' | 'update';
  row: Record<string, unknown>;
  baseUpdatedAt: string | null;
  tries: number;
}

export interface PendingUpload {
  docId: string;
  blob: Blob;
  fileName: string;
  mime: string;
}

let dbp: Promise<IDBPDatabase> | null = null;

export function idb(): Promise<IDBPDatabase> {
  dbp ??= openDB('bina', 1, {
    upgrade(db) {
      db.createObjectStore('cache');                       // key: table name → rows[]
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('uploads', { keyPath: 'docId' });
      db.createObjectStore('blobs');                       // demo-mode file storage + local previews
      db.createObjectStore('kv');
    },
  });
  return dbp;
}
