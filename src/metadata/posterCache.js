// Gestor de caché de portadas en IndexedDB con límite en MB y política LRU
import { createKV } from '../core/kv.js';
import { getCacheMaxMb } from '../settings/global.js';

const posterKV = createKV('tgvideo_posters', 'posters');
const blobUrls = new Map();

/**
 * Obtiene la URL local de la carátula si ya está en caché, o descarga y almacena.
 */
export async function getCachedPosterUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return url;
  if (blobUrls.has(url)) return blobUrls.get(url);

  try {
    const item = await posterKV.get(url);
    if (item && item.blob) {
      // Tocar timestamp de último uso (LRU)
      posterKV.set(url, { ...item, lastUsed: Date.now() }).catch(() => {});
      const objectUrl = URL.createObjectURL(item.blob);
      blobUrls.set(url, objectUrl);
      return objectUrl;
    }
  } catch (err) {
    console.warn('[posterCache] Error leyendo caché', err);
  }

  // Si no está en caché, descargar en segundo plano
  cachePosterInBackground(url).catch(() => {});
  return url;
}

/**
 * Carga una carátula en un elemento <img> usando la caché o descargándola.
 */
export function loadPoster(img, url) {
  if (!img || !url) return;
  if (blobUrls.has(url)) {
    img.src = blobUrls.get(url);
    return;
  }

  // Priorizar IndexedDB antes de emitir solicitudes a la red
  posterKV.get(url).then((item) => {
    if (item?.blob) {
      const objectUrl = URL.createObjectURL(item.blob);
      blobUrls.set(url, objectUrl);
      if (img.isConnected) {
        img.src = objectUrl;
        img.addEventListener('error', () => {
          if (img.src !== url) img.src = url;
        }, { once: true });
      }
      posterKV.set(url, { ...item, lastUsed: Date.now() }).catch(() => {});
    } else {
      if (img.isConnected) {
        img.src = url;
      }
      cachePosterInBackground(url).catch(() => {});
    }
  }).catch(() => {
    if (img.isConnected) img.src = url;
  });
}

async function cachePosterInBackground(url) {
  if (!url || !url.startsWith('http')) return null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const size = blob.size || 0;
    const maxBytes = (getCacheMaxMb() || 100) * 1024 * 1024;

    // Asegurar cuota aplicando política LRU
    await enforceQuota(size, maxBytes);

    const record = {
      url,
      blob,
      size,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    };
    await posterKV.set(url, record);
    const objectUrl = URL.createObjectURL(blob);
    blobUrls.set(url, objectUrl);
    return objectUrl;
  } catch (err) {
    console.warn('[posterCache] No se pudo guardar carátula en caché', err);
    return null;
  }
}

async function enforceQuota(newBytes, maxBytes) {
  try {
    const entries = await posterKV.entries();
    let totalBytes = entries.reduce((acc, [, item]) => acc + (item?.size || 0), 0);
    if (totalBytes + newBytes <= maxBytes) return;

    // Ordenar de más antigua a más reciente según lastUsed (LRU)
    entries.sort(([, a], [, b]) => (a?.lastUsed || a?.createdAt || 0) - (b?.lastUsed || b?.createdAt || 0));

    for (const [key, item] of entries) {
      if (totalBytes + newBytes <= maxBytes) break;
      await posterKV.del(key);
      if (blobUrls.has(key)) {
        try { URL.revokeObjectURL(blobUrls.get(key)); } catch (_) {}
        blobUrls.delete(key);
      }
      totalBytes -= (item?.size || 0);
    }
  } catch (err) {
    console.warn('[posterCache] Error al aplicar cuota LRU', err);
  }
}

/**
 * Devuelve las estadísticas actuales de la caché.
 */
export async function getPosterCacheStats() {
  try {
    const entries = await posterKV.entries();
    const count = entries.length;
    const bytes = entries.reduce((acc, [, item]) => acc + (item?.size || 0), 0);
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    const maxMb = getCacheMaxMb() || 100;
    return { count, bytes, mb, maxMb };
  } catch (err) {
    console.warn('[posterCache] Error al obtener estadísticas', err);
    return { count: 0, bytes: 0, mb: '0.0', maxMb: getCacheMaxMb() || 100 };
  }
}

/**
 * Optimiza la caché: elimina carátulas que no correspondan a ningún elemento activo.
 */
export async function optimizePosterCache(activeUrls = []) {
  try {
    const entries = await posterKV.entries();
    const activeSet = new Set(activeUrls.filter(Boolean));
    let deleted = 0;
    let freedBytes = 0;

    if (activeSet.size > 0) {
      for (const [key, item] of entries) {
        if (!activeSet.has(key)) {
          await posterKV.del(key);
          if (blobUrls.has(key)) {
            try { URL.revokeObjectURL(blobUrls.get(key)); } catch (_) {}
            blobUrls.delete(key);
          }
          deleted++;
          freedBytes += (item?.size || 0);
        }
      }
    }

    // Por si aún excede el límite máximo configurado
    const maxBytes = (getCacheMaxMb() || 100) * 1024 * 1024;
    await enforceQuota(0, maxBytes);

    const freedMb = (freedBytes / (1024 * 1024)).toFixed(1);
    return { deleted, freedBytes, freedMb };
  } catch (err) {
    console.warn('[posterCache] Error al optimizar', err);
    return { deleted: 0, freedBytes: 0, freedMb: '0.0' };
  }
}

/**
 * Borra toda la caché de portadas.
 */
export async function clearPosterCache() {
  try {
    for (const url of blobUrls.values()) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
    blobUrls.clear();
    await posterKV.clear();
    return true;
  } catch (err) {
    console.warn('[posterCache] Error al vaciar caché', err);
    return false;
  }
}
