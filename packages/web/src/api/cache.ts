/**
 * Simple in-memory cache for Airtable list responses.
 * TTL default: 2 minutes. Writes should call invalidate() on the affected table.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  data: any;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

function cacheKey(tableId: string, params: object = {}): string {
  return `${tableId}::${JSON.stringify(params)}`;
}

export function cacheGet(tableId: string, params: object = {}): any | null {
  const key = cacheKey(tableId, params);
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

export function cacheSet(tableId: string, params: object = {}, data: any, ttl = DEFAULT_TTL_MS) {
  const key = cacheKey(tableId, params);
  store.set(key, { data, expiresAt: Date.now() + ttl });
}

/** Bust all cached entries for a given table (call after any write to that table). */
export function invalidateTable(tableId: string) {
  for (const key of store.keys()) {
    if (key.startsWith(`${tableId}::`)) {
      store.delete(key);
    }
  }
}

/** Bust everything — nuclear option. */
export function invalidateAll() {
  store.clear();
}
