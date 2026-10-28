// تخزين بسيط على الجهاز (IndexedDB) للعمل بدون إنترنت.
// إذا لم يكن IndexedDB متاحاً (وضع خاص في بعض المتصفحات) نستعمل الذاكرة فقط.

export type StoreName = "http" | "outbox" | "rejected" | "meta";
const STORES: StoreName[] = ["http", "outbox", "rejected", "meta"];
const DB_NAME = "grade-system";

let dbp: Promise<IDBDatabase | null> | null = null;
const mem: Record<StoreName, Map<string, unknown>> = { http: new Map(), outbox: new Map(), rejected: new Map(), meta: new Map() };

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return open().then((db) => new Promise<T | undefined>((resolve) => {
    if (!db) return resolve(undefined);
    try {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  }));
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return mem[store].get(key) as T | undefined;
  return run<T>(store, "readonly", (s) => s.get(key));
}

export async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) { mem[store].set(key, value); return; }
  await run(store, "readwrite", (s) => s.put(value, key));
}

export async function idbDel(store: StoreName, key: string): Promise<void> {
  const db = await open();
  if (!db) { mem[store].delete(key); return; }
  await run(store, "readwrite", (s) => s.delete(key));
}

export async function idbEntries<T>(store: StoreName): Promise<[string, T][]> {
  const db = await open();
  if (!db) return [...mem[store].entries()] as [string, T][];
  const [keys, values] = await Promise.all([
    run<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys()),
    run<T[]>(store, "readonly", (s) => s.getAll()),
  ]);
  return (keys ?? []).map((k, i) => [String(k), (values ?? [])[i]]);
}

export async function idbClear(store: StoreName): Promise<void> {
  const db = await open();
  if (!db) { mem[store].clear(); return; }
  await run(store, "readwrite", (s) => s.clear());
}
