// Gestor de caché de portadas en IndexedDB con límite en MB y política LRU
import { createKV } from '../core/kv.js';
import { getCacheMaxMb } from '../settings/global.js';

const posterKV = createKV('tgvideo_posters', 'posters');
const memoryCache = new Map();
const inFlight = new Set();
let quotaTimer = null;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function scheduleQuotaCheck() {
  clearTimeout(quotaTimer);
  quotaTimer = setTimeout(() => {
    const maxBytes = (getCacheMaxMb() || 100) * 1024 * 1024;
    enforceQuota(0, maxBytes).catch(() => {});
  }, 4000);
}

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

  if (memoryCache.has(targetUrl)) {
    const cached = memoryCache.get(targetUrl);
    if (img.src !== cached) img.src = cached;
    return;
  }

  if (!img.src || img.src === window.location.href) {
    img.src = targetUrl;
  }

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
    const size = blob.size || 0;

    const dataUrl = await blobToDataUrl(blob);
    memoryCache.set(url, dataUrl);

    const record = { url, dataUrl, size, lastUsed: Date.now(), createdAt: Date.now() };
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
