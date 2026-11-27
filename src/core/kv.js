// src/core/kv.js
// Almacén local con IndexedDB y fallback seguro en memoria/localStorage
// para evitar bloqueos en iOS WebKit / Safari, modo incógnito o WebView.

export function createKV(dbName = 'tgvideo', store = 'kv') {
  const memoryFallback = new Map();

  const openIndexedDB = () => {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB not supported'));
    }

    return new Promise((res, rej) => {
      let settled = false;
      // Timeout de seguridad: si Safari / WebKit se congela al abrir IndexedDB, abortar tras 2000 ms
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          rej(new Error('IndexedDB open timeout (Safari/WebKit fallback)'));
        }
      }, 2000);

      try {
        const r = indexedDB.open(dbName, 1);
        r.onupgradeneeded = () => {
          try {
            if (!r.result.objectStoreNames.contains(store)) {
              r.result.createObjectStore(store);
            }
          } catch (e) {
            console.warn('[kv] onupgradeneeded error', e);
          }
        };
        r.onsuccess = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            res(r.result);
          }
        };
        r.onerror = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            rej(r.error || new Error('IndexedDB open error'));
          }
        };
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          rej(err);
        }
      }
    });
  };

  const dbp = openIndexedDB().catch(err => {
    console.warn(`[kv:${dbName}:${store}] Fallback en memoria activado:`, err?.message || err);
    return null;
  });

  const tx = async (mode, fn, fallbackFn) => {
    try {
      const db = await dbp;
      if (!db) return fallbackFn();
      return await new Promise((res, rej) => {
        try {
          const t = db.transaction(store, mode);
          const s = t.objectStore(store);
          const req = fn(s);
          t.oncomplete = () => res(req?.result);
          t.onerror = () => {
            console.warn(`[kv:${dbName}] Error en transacción, usando fallback`);
            res(fallbackFn());
          };
          t.onabort = () => res(fallbackFn());
        } catch (e) {
          res(fallbackFn());
        }
      });
    } catch (_) {
      return fallbackFn();
    }
  };

  return {
    get: (k) => tx('readonly', (s) => s.get(k), () => memoryFallback.get(k)),
    set: (k, v) => tx('readwrite', (s) => s.put(v, k), () => { memoryFallback.set(k, v); return v; }),
    del: (k) => tx('readwrite', (s) => s.delete(k), () => { memoryFallback.delete(k); return true; }),
    keys: () => tx('readonly', (s) => s.getAllKeys(), () => Array.from(memoryFallback.keys())),
    values: () => tx('readonly', (s) => s.getAll(), () => Array.from(memoryFallback.values())),
    clear: () => tx('readwrite', (s) => s.clear(), () => { memoryFallback.clear(); return true; }),
    entries: async () => {
      try {
        const db = await dbp;
        if (!db) return Array.from(memoryFallback.entries());
        return await new Promise((res) => {
          try {
            const t = db.transaction(store, 'readonly');
            const s = t.objectStore(store);
            const entries = [];
            const req = s.openCursor();
            req.onsuccess = (e) => {
              const cursor = e.target.result;
              if (cursor) {
                entries.push([cursor.key, cursor.value]);
                cursor.continue();
              } else {
                res(entries);
              }
            };
            req.onerror = () => res(Array.from(memoryFallback.entries()));
          } catch (_) {
            res(Array.from(memoryFallback.entries()));
          }
        });
      } catch (_) {
        return Array.from(memoryFallback.entries());
      }
    },
  };
}
