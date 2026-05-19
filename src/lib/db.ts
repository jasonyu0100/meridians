/**
 * inktide-main — the single IndexedDB database for the entire app.
 *
 * One database, many object stores. Everything that needs persistent
 * client-side storage lives here so the connection lifecycle, schema
 * version, and upgrade pathway are managed in exactly one place.
 *
 * Stores:
 *   narratives — full NarrativeState records (key = narrative id)
 *   meta       — assorted ui state + per-narrative auxiliary data
 *   apiLogs    — recent API call log batches
 *   embeddings — Float32Array vectors for semantic search
 *   audio      — scene audio blobs
 *   images     — character / location / artifact / cover image blobs
 *   texts      — SourceFile contents (raw corpus + extracted slice JSON)
 *
 * Callers go through `openMainDB()`; the promise is memoised so every
 * call shares one underlying connection. Adding a new store: bump
 * DB_VERSION, declare it on `MainDB`, and add an idempotent `if
 * (!db.objectStoreNames.contains(...)) ...` clause in the upgrade
 * callback. Every clause is guarded so the upgrade is replay-safe
 * across schema bumps.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

const DB_NAME = 'inktide-main';
const DB_VERSION = 4;

export interface MainDB extends DBSchema {
  narratives: {
    key: string;
    /** Stored shape is NarrativeState, but we keep it `unknown` at the
     *  schema layer so the persistence helpers stay generic and we
     *  don't drag the full type into this module. */
    value: unknown;
  };
  meta: {
    key: string;
    value: unknown;
  };
  apiLogs: {
    key: string;
    value: unknown;
  };
  embeddings: {
    key: string;
    value: {
      id: string;
      vector: Float32Array;
      model: string;
      narrativeId: string;
      createdAt: number;
    };
    indexes: { 'by-narrative': string };
  };
  audio: {
    key: string;
    value: {
      id: string;
      blob: Blob;
      format: string;
      duration?: number;
      narrativeId: string;
      createdAt: number;
    };
    indexes: { 'by-narrative': string };
  };
  images: {
    key: string;
    value: {
      id: string;
      blob: Blob;
      format: string;
      width?: number;
      height?: number;
      narrativeId: string;
      createdAt: number;
    };
    indexes: { 'by-narrative': string };
  };
  texts: {
    key: string;
    value: {
      id: string;
      content: string;
      narrativeId: string;
      createdAt: number;
    };
    indexes: { 'by-narrative': string };
  };
}

export class IndexedDBUnavailableError extends Error {
  constructor(reason: string) {
    super(`IndexedDB unavailable: ${reason}`);
    this.name = 'IndexedDBUnavailableError';
  }
}

export class IndexedDBQuotaExceededError extends Error {
  constructor(operation: string) {
    super(`Storage quota exceeded during: ${operation}`);
    this.name = 'IndexedDBQuotaExceededError';
  }
}

export function checkIndexedDBAvailability(): { available: boolean; reason?: string } {
  if (typeof window === 'undefined') {
    return { available: false, reason: 'Running on server (SSR)' };
  }
  if (!window.indexedDB) {
    return { available: false, reason: 'Browser does not support IndexedDB' };
  }
  return { available: true };
}

let dbPromise: Promise<IDBPDatabase<MainDB>> | null = null;

/** Open (or return the cached handle to) the inktide-main database.
 *  Idempotent and concurrency-safe — every caller awaits the same
 *  promise, so we open the underlying connection exactly once. */
export function openMainDB(): Promise<IDBPDatabase<MainDB>> {
  if (dbPromise) return dbPromise;
  // `indexedDB` rather than `window` so tests with fake-indexeddb (which
  // polyfills globalThis.indexedDB but not window) still open the DB.
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB not available'));
  }
  dbPromise = openDB<MainDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Each clause is guarded by contains() so the upgrade is
      // replay-safe across schema bumps — only missing stores are
      // created. Indexes go up alongside their stores.
      if (!db.objectStoreNames.contains('narratives')) {
        db.createObjectStore('narratives');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
      if (!db.objectStoreNames.contains('apiLogs')) {
        db.createObjectStore('apiLogs');
      }
      if (!db.objectStoreNames.contains('embeddings')) {
        const s = db.createObjectStore('embeddings', { keyPath: 'id' });
        s.createIndex('by-narrative', 'narrativeId');
      }
      if (!db.objectStoreNames.contains('audio')) {
        const s = db.createObjectStore('audio', { keyPath: 'id' });
        s.createIndex('by-narrative', 'narrativeId');
      }
      if (!db.objectStoreNames.contains('images')) {
        const s = db.createObjectStore('images', { keyPath: 'id' });
        s.createIndex('by-narrative', 'narrativeId');
      }
      if (!db.objectStoreNames.contains('texts')) {
        const s = db.createObjectStore('texts', { keyPath: 'id' });
        s.createIndex('by-narrative', 'narrativeId');
      }
    },
    terminated() {
      // Browser killed the connection (storage pressure, private-mode
      // quirks). Drop the cached promise so the next call reopens.
      dbPromise = null;
    },
  });
  return dbPromise;
}
