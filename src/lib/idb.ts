/**
 * IndexedDB helpers — thin wrappers around the shared `meridians-main`
 * connection from `./db`. The functions in this module preserve the
 * pre-consolidation API (idbGet, idbPut, …) so persistence.ts callers
 * didn't have to change when the asset stores moved into meridians-main.
 *
 * Re-exports the availability + error types from `./db` so existing
 * imports against `@/lib/idb` keep working.
 */

import type { IDBPDatabase } from 'idb';
import { openMainDB } from '@/lib/db';

export {
  checkIndexedDBAvailability,
  IndexedDBUnavailableError,
  IndexedDBQuotaExceededError,
} from '@/lib/db';

/** The shared connection's typed handle carries a literal-union
 *  StoreName constraint that breaks generic `string` callers. This
 *  helper unwraps it so the legacy helpers below can pass arbitrary
 *  store-name strings — runtime IDB is untyped anyway, the cast just
 *  bypasses the wrapper's narrowing. */
async function untypedDb(): Promise<IDBPDatabase> {
  return (await openMainDB()) as unknown as IDBPDatabase;
}

export async function openDB(): Promise<IDBDatabase> {
  // Legacy callers that want the raw IDBDatabase handle. Prefer the
  // helpers below; kept for the rare case where existing code passes
  // the handle around.
  return (await untypedDb()) as unknown as IDBDatabase;
}

export async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await untypedDb();
  return (await db.get(storeName, key)) as T | undefined;
}

export async function idbPut(storeName: string, key: string, value: unknown): Promise<void> {
  const db = await untypedDb();
  // narratives/meta/apiLogs use out-of-line keys; the asset stores use
  // in-line keys (keyPath: 'id'). For out-of-line stores we pass `key`
  // explicitly; for in-line stores idb derives it from value.id and
  // ignores the second arg.
  await db.put(storeName, value, key);
}

export async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await untypedDb();
  await db.delete(storeName, key);
}

export async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await untypedDb();
  return (await db.getAll(storeName)) as T[];
}

export async function idbGetAllKeys(storeName: string): Promise<string[]> {
  const db = await untypedDb();
  return (await db.getAllKeys(storeName)) as string[];
}

export async function idbDeleteByPrefix(storeName: string, prefix: string): Promise<void> {
  const db = await untypedDb();
  const tx = db.transaction(storeName, 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

// Store name constants — preserved from the pre-consolidation API. The
// new asset stores live in `db.ts`'s MainDB schema; this module
// surfaces the narrative-facing ones for symmetry with old imports.
export const NARRATIVES_STORE = 'narratives';
export const META_STORE = 'meta';
export const API_LOGS_STORE = 'apiLogs';
