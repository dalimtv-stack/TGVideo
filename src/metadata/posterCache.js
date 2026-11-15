// Gestor de caché de portadas en IndexedDB con redimensionado a 800px y política LRU
import { createKV } from '../core/kv.js';
import { getCacheMaxMb } from '../settings/global.js';

const posterKV = createKV('tgvideo_posters', 'posters');
export const memoryCache = new Map();
const inFlight = new Set();
let quotaTimer = null;

/**
 * Optimiza y redimensiona la imagen a un lado mayor de 800px (estilo TGComic).
 * Produce WebP de alta eficiencia (~25-35 KB) o JPEG como fallback.
 */
async function optimizeImageTo800px(blob, maxEdge = 800, quality = 0.8) {
  if (!blob || !blob.size) return null;

  let bmp = null;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    try {
      const url = URL.createObjectURL(blob);
      bmp = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = url;
      });
      try { URL.revokeObjectURL(url); } catch (_) {}
    } catch {
      return null;
    }
  }

  const srcW = bmp.width || bmp.naturalWidth || 0;
  const srcH = bmp.height || bmp.naturalHeight || 0;
  if (!srcW || !srcH) {
    try { bmp.close?.(); } catch (_) {}
    return null;
  }

  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  try { bmp.close?.(); } catch (_) {}

  // Intentar WebP primero; si no soporta, fallback a JPEG
  let dataUrl = null;
  try {
    const webpUrl = cv.toDataURL('image/webp', quality);
    if (webpUrl && webpUrl.startsWith('data:image/webp')) {
      dataUrl = webpUrl;
    }
  } catch (_) {}

  if (!dataUrl) {
    try {
      dataUrl = cv.toDataURL('image/jpeg', Math.min(0.82, quality));
    } catch (_) {}
  }

  cv.width = 0;
  cv.height = 0;
  return dataUrl;
}

function scheduleQuotaCheck() {
  clearTimeout(quotaTimer);
  quotaTimer = setTimeout(() => {
    const maxBytes = (getCacheMaxMb() || 100) * 1024 * 1024;
    enforceQuota(0, maxBytes).catch(() => {});
  }, 4000);
}

/**
 * Precarga en memoria las carátulas cacheadas en IndexedDB para los títulos dados.
 * Esto permite que al volver a Home o renderizar tarjetas, la imagen se pinte en 0 ms.
 */
export async function prewarmPosterCache(titles = []) {
  const urls = [];
  for (const t of titles) {
    if (t.metadata?.poster && !memoryCache.has(t.metadata.poster)) {
      urls.push(t.metadata.poster);
    }
    if (t.archivos) {
      for (const f of t.archivos) {
        if (f.metadata?.poster && !memoryCache.has(f.metadata.poster)) {
          urls.push(f.metadata.poster);
        }
      }
    }
  }

  if (!urls.length) return;

  await Promise.all(urls.map(async (url) => {
    try {
      const item = await posterKV.get(url);
      if (item) {
        const src = item.dataUrl || (item.blob ? URL.createObjectURL(item.blob) : null);
        if (src) memoryCache.set(url, src);
      }
    } catch (_) {}
  }));
}

/**
 * Obtiene la URL local de la carátula si ya está en caché, o descarga y almacena.
 */
export async function getCachedPosterUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return url;
  if (memoryCache.has(url)) return memoryCache.get(url);

  try {
    const item = await posterKV.get(url);
    if (item) {
      const src = item.dataUrl || (item.blob ? URL.createObjectURL(item.blob) : null);
      if (src) {
        posterKV.set(url, { ...item, lastUsed: Date.now() }).catch(() => {});
        memoryCache.set(url, src);
        return src;
      }
    }
  } catch (err) {
    console.warn('[posterCache] Error leyendo caché', err);
  }

  cachePosterInBackground(url).catch(() => {});
  return url;
}

/**
 * Carga una carátula en un elemento <img> de manera segura, usando la caché
 * o descargándola de la red con fallback garantizado.
 */
export function loadPoster(img, url) {
  if (!img || !url || typeof url !== 'string' || !url.startsWith('http')) return;

  const targetUrl = url;

  const setupErrorHandler = () => {
    img.onerror = () => {
      if (img.src !== targetUrl) {
        img.src = targetUrl;
      } else {
        img.remove();
      }
    };
  };

  setupErrorHandler();

  // 1. Si ya está en la memoria activa (DataURL o BlobURL), aplicar inmediatamente
  if (memoryCache.has(targetUrl)) {
    const cached = memoryCache.get(targetUrl);
    if (img.src !== cached) img.src = cached;
    return;
  }

  // 2. Establecer la URL directa de inmediato si la imagen aún no tiene fuente asignada
  if (!img.src || img.src === window.location.href) {
    img.src = targetUrl;
  }

  // 3. Consultar IndexedDB en segundo plano
  posterKV.get(targetUrl).then(async (item) => {
    if (!item) {
      cachePosterInBackground(targetUrl).catch(() => {});
      return;
    }

    let localUrl = item.dataUrl || (item.blob ? URL.createObjectURL(item.blob) : null);
    if (localUrl) {
      memoryCache.set(targetUrl, localUrl);
      if (img.isConnected && img.src !== localUrl) {
        setupErrorHandler();
        img.src = localUrl;
      }
      posterKV.set(targetUrl, { ...item, lastUsed: Date.now() }).catch(() => {});
    } else {
      cachePosterInBackground(targetUrl).catch(() => {});
    }
  }).catch(() => {
    if (img.isConnected && (!img.src || img.src === window.location.href)) {
      img.src = targetUrl;
    }
  });
}

async function cachePosterInBackground(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
  if (memoryCache.has(url) || inFlight.has(url)) return memoryCache.get(url) || null;

  inFlight.add(url);
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();

    // Redimensionar a 800px máx y optimizar en WebP/JPEG (estilo TGComic)
    const dataUrl = await optimizeImageTo800px(blob, 800, 0.8);
    if (!dataUrl) return null;

    const approxSize = Math.round(dataUrl.length * 0.75);
    memoryCache.set(url, dataUrl);

    const record = { url, dataUrl, size: approxSize, lastUsed: Date.now(), createdAt: Date.now() };
    await posterKV.set(url, record);
    scheduleQuotaCheck();
    return dataUrl;
  } catch (err) {
    return null;
  } finally {
    inFlight.delete(url);
  }
}

async function enforceQuota(newBytes, maxBytes) {
  try {
    const entries = await posterKV.entries();
    let totalBytes = entries.reduce((acc, [, item]) => acc + (item?.size || 0), 0);
    if (totalBytes + newBytes <= maxBytes) return;

    entries.sort(([, a], [, b]) => (a?.lastUsed || a?.createdAt || 0) - (b?.lastUsed || b?.createdAt || 0));

    for (const [key, item] of entries) {
      if (totalBytes + newBytes <= maxBytes) break;
      await posterKV.del(key);
      memoryCache.delete(key);
      totalBytes -= (item?.size || 0);
    }
  } catch (err) {
    console.warn('[posterCache] Error al aplicar cuota LRU', err);
  }
}

export async function getPosterCacheStats() {
  try {
    const entries = await posterKV.entries();
    const count = entries.length;
    const bytes = entries.reduce((acc, [, item]) => acc + (item?.size || 0), 0);
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    const maxMb = getCacheMaxMb() || 100;
    return { count, bytes, mb, maxMb };
  } catch (err) {
    return { count: 0, bytes: 0, mb: '0.0', maxMb: getCacheMaxMb() || 100 };
  }
}

export async function optimizePosterCache(activeUrls = []) {
  try {
    const entries = await posterKV.entries();
    const activeSet = new Set(activeUrls.filter(Boolean));
    let deleted = 0, freedBytes = 0;

    if (activeSet.size > 0) {
      for (const [key, item] of entries) {
        if (!activeSet.has(key)) {
          await posterKV.del(key);
          memoryCache.delete(key);
          deleted++;
          freedBytes += (item?.size || 0);
        }
      }
    }

    const maxBytes = (getCacheMaxMb() || 100) * 1024 * 1024;
    await enforceQuota(0, maxBytes);
    const freedMb = (freedBytes / (1024 * 1024)).toFixed(1);
    return { deleted, freedBytes, freedMb };
  } catch (err) {
    return { deleted: 0, freedBytes: 0, freedMb: '0.0' };
  }
}

export async function clearPosterCache() {
  try {
    memoryCache.clear();
    await posterKV.clear();
    return true;
  } catch (err) {
    return false;
  }
}
