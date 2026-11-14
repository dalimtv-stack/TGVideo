// Almacén local (IndexedDB) para la biblioteca de canales y caché
export function createKV(dbName = 'tgvideo', store = 'kv') {
  const dbp = new Promise((res, rej) => {
    const r = indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(store)) {
        r.result.createObjectStore(store);
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const db = await dbp;
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: (k) => tx('readonly', (s) => s.get(k)),
    set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
    del: (k) => tx('readwrite', (s) => s.delete(k)),
    keys: () => tx('readonly', (s) => s.getAllKeys()),
    values: () => tx('readonly', (s) => s.getAll()),
    clear: () => tx('readwrite', (s) => s.clear()),
    entries: async () => {
      const db = await dbp;
      return new Promise((res, rej) => {
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
        req.onerror = () => rej(req.error);
      });
    },
  };
}
