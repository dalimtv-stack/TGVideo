// src/core/updateCheck.js
// Comprobación de nuevas versiones en GitHub Releases para TGVideo
import pkg from '../../package.json';

export const CURRENT_VERSION = pkg.version || '0.2.0';
const GITHUB_REPO = 'dalimtv-stack/TGVideo';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos

/**
 * Compara dos versiones semver (ej: 'v0.7.3' vs '0.7.2' o '0.10.0' vs '0.2.0').
 * Devuelve true si remoteTag es estrictamente superior a localVer.
 */
export function isNewerVersion(remoteTag, localVer = CURRENT_VERSION) {
  if (!remoteTag) return false;
  const cleanRemote = String(remoteTag).replace(/^[^\d]*/, '').split('-')[0].trim();
  const cleanLocal = String(localVer).replace(/^[^\d]*/, '').split('-')[0].trim();
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
 * Incorpora cache-busting, control estricto de caché y fallbacks (raw package.json)
 * para evitar bloqueos por rate limit de la API no autenticada de GitHub.
 */
export async function checkForUpdate(force = false) {
  const now = Date.now();

  if (force) {
    memoryCache = null;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('tgvideo_update_check');
      } catch (_) {}
    }
  }

  if (!force && memoryCache && (now - memoryCache.timestamp < CACHE_TTL_MS)) {
    return memoryCache.data;
  }

  if (!force && typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem('tgvideo_update_check');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.data?.currentVersion === CURRENT_VERSION && parsed.timestamp && (now - parsed.timestamp < CACHE_TTL_MS)) {
          memoryCache = parsed;
          return parsed.data;
        }
      }
    } catch (_) {}
  }

  // 1. Intento primario: GitHub Releases API (/releases/latest) con cache-busting
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest?_t=${now}`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      cache: 'no-store',
    });

    if (res.ok) {
      const release = await res.json();
      const remoteTag = release.tag_name || '';
      const hasUpdate = isNewerVersion(remoteTag, CURRENT_VERSION);

      const apkAsset = release.assets?.find(a => a.name === 'TGVideo.apk') ||
                       release.assets?.find(a => a.name?.endsWith('.apk'));
      const downloadUrl = apkAsset?.browser_download_url ||
                          `https://github.com/${GITHUB_REPO}/releases/latest/download/TGVideo.apk`;

      const data = {
        hasUpdate,
        currentVersion: CURRENT_VERSION,
        latestVersion: remoteTag,
        releaseUrl: release.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
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
    }
  } catch (err) {
    console.warn('[updateCheck] Fallo en endpoint /releases/latest:', err);
  }

  // 2. Fallback secundario: Listado de releases (/releases?per_page=1)
  try {
    const resList = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=1&_t=${now}`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      cache: 'no-store',
    });

    if (resList.ok) {
      const releases = await resList.json();
      if (Array.isArray(releases) && releases.length > 0) {
        const release = releases[0];
        const remoteTag = release.tag_name || '';
        const hasUpdate = isNewerVersion(remoteTag, CURRENT_VERSION);

        const apkAsset = release.assets?.find(a => a.name === 'TGVideo.apk') ||
                         release.assets?.find(a => a.name?.endsWith('.apk'));
        const downloadUrl = apkAsset?.browser_download_url ||
                            `https://github.com/${GITHUB_REPO}/releases/latest/download/TGVideo.apk`;

        const data = {
          hasUpdate,
          currentVersion: CURRENT_VERSION,
          latestVersion: remoteTag,
          releaseUrl: release.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
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
      }
    }
  } catch (err) {
    console.warn('[updateCheck] Fallo en fallback /releases list:', err);
  }

  // 3. Fallback terciario: raw package.json en rama main (inmune al límite de 60 req/h de la API)
  try {
    const resRaw = await fetch(`https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json?_t=${now}`, {
      cache: 'no-store',
    });

    if (resRaw.ok) {
      const rawPkg = await resRaw.json();
      const remoteVersion = rawPkg?.version ? `v${rawPkg.version}` : '';
      const hasUpdate = isNewerVersion(remoteVersion, CURRENT_VERSION);

      const data = {
        hasUpdate,
        currentVersion: CURRENT_VERSION,
        latestVersion: remoteVersion,
        releaseUrl: `https://github.com/${GITHUB_REPO}/releases/latest`,
        downloadUrl: `https://github.com/${GITHUB_REPO}/releases/latest/download/TGVideo.apk`,
        name: `TGVideo ${remoteVersion}`,
        notes: '',
        publishedAt: new Date().toISOString(),
      };

      memoryCache = { timestamp: now, data };
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('tgvideo_update_check', JSON.stringify(memoryCache));
        } catch (_) {}
      }
      return data;
    }
  } catch (err) {
    console.warn('[updateCheck] Fallo en fallback raw package.json:', err);
  }

  return null;
}
