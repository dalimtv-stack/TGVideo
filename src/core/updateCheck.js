// src/core/updateCheck.js
// Comprobación de nuevas versiones en GitHub Releases para TGVideo
import pkg from '../../package.json';

export const CURRENT_VERSION = pkg.version || '0.2.0';
const GITHUB_REPO = 'dalimtv-stack/TGVideo';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos

/**
 * Compara dos versiones semver (ej: 'v0.2.1' vs '0.2.0' o '0.10.0' vs '0.2.0').
 * Devuelve true si remoteTag es estrictamente superior a localVer.
 */
export function isNewerVersion(remoteTag, localVer = CURRENT_VERSION) {
  if (!remoteTag) return false;
  const cleanRemote = String(remoteTag).replace(/^v/i, '').trim();
  const cleanLocal = String(localVer).replace(/^v/i, '').trim();
  if (cleanRemote === cleanLocal) return false;

  const rParts = cleanRemote.split('.').map(n => parseInt(n, 10) || 0);
  const lParts = cleanLocal.split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(rParts.length, lParts.length);

  for (let i = 0; i < len; i++) {
    const r = rParts[i] || 0;
    const l = lParts[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

let memoryCache = null;

/**
 * Consulta la API pública de GitHub para obtener la última release publicada.
 * Cachea el resultado para optimizar consumo y velocidad.
 */
export async function checkForUpdate(force = false) {
  const now = Date.now();

  if (!force && memoryCache && (now - memoryCache.timestamp < CACHE_TTL_MS)) {
    return memoryCache.data;
  }

  if (!force && typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem('tgvideo_update_check');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.timestamp && (now - parsed.timestamp < CACHE_TTL_MS)) {
          memoryCache = parsed;
          return parsed.data;
        }
      }
    } catch (_) {}
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return null;

    const release = await res.json();
    const remoteTag = release.tag_name || '';
    const hasUpdate = isNewerVersion(remoteTag, CURRENT_VERSION);

    const apkAsset = release.assets?.find(a => a.name === 'TGVideo.apk') ||
                     release.assets?.find(a => a.name?.endsWith('.apk'));
    const downloadUrl = apkAsset?.browser_download_url || release.html_url;

    const data = {
      hasUpdate,
      currentVersion: CURRENT_VERSION,
      latestVersion: remoteTag,
      releaseUrl: release.html_url,
      downloadUrl,
      name: release.name || remoteTag,
      notes: release.body || '',
      publishedAt: release.published_at,
    };

    memoryCache = { timestamp: now, data };
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('tgvideo_update_check', JSON.stringify(memoryCache));
      } catch (_) {}
    }

    return data;
  } catch (err) {
    console.warn('[updateCheck] Error comprobando releases de GitHub:', err);
    return null;
  }
}
