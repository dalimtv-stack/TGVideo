// src/metadata/imagePrefs.js
// Imágenes elegidas por el usuario (cartel / fondo / logo) para cada título.
// - Por perfil: profile.image_prefs[titleId] (viaja en la sincronización del perfil).
// - Caché del dispositivo: localStorage `tgvideo_imgprefs_<perfil>` (funciona sin conexión).
import { loadProgress, loadFavorites } from '../player/progress.js';

export const IMAGE_KINDS = { poster: 'Cartel', backdrop: 'Fondo', logo: 'Logo' };

const storeKey = (profile) => `tgvideo_imgprefs_${profile?.id || 'default'}`;

export function readLocal(profile) {
  try { return JSON.parse(localStorage.getItem(storeKey(profile)) || '{}') || {}; } catch (_) { return {}; }
}

export function writeLocal(profile, data) {
  try { localStorage.setItem(storeKey(profile), JSON.stringify(data)); } catch (_) {}
}

export function readImagePrefs(profile) {
  const local = readLocal(profile);
  const inMem = profile?.image_prefs && typeof profile.image_prefs === 'object' ? profile.image_prefs : {};
  // Combinar memoria y local priorizando la marca temporal más reciente
  const merged = { ...local };
  for (const [k, v] of Object.entries(inMem)) {
    if (!v) continue;
    const l = merged[k];
    if (!l || (v.updated_at || 0) >= (l.updated_at || 0)) {
      merged[k] = v;
    }
  }
  return merged;
}

export function saveLocalImagePrefs(profile, prefs) {
  writeLocal(profile, prefs);
  if (profile) {
    profile.image_prefs = prefs;
  }
  return prefs;
}

export function getImagePrefs(profile, titleOrId) {
  if (!profile || !titleOrId) return {};
  const allProfile = profile?.image_prefs && typeof profile.image_prefs === 'object' ? profile.image_prefs : {};
  const allLocal = readLocal(profile);

  const getBest = (key) => {
    if (!key) return {};
    const k = String(key);
    const p = allProfile[k] || {};
    const l = allLocal[k] || {};
    return (l.updated_at || 0) > (p.updated_at || 0) ? l : p;
  };

  if (typeof titleOrId === 'string' || typeof titleOrId === 'number') {
    return getBest(titleOrId);
  }

  const t = titleOrId;
  let res = getBest(t.id);
  if (res.poster && res.backdrop && res.logo) return res;

  if (t.tmdbId) {
    const byTmdb = getBest(t.tmdbId);
    res = { ...byTmdb, ...res };
    const byTmdbPrefixed = getBest(`tmdb:${t.tmdbId}`);
    res = { ...byTmdbPrefixed, ...res };
  }
  if (t.archivos) {
    for (const f of t.archivos) {
      const byFile = getBest(`${f.channel}:${f.messageId}`);
      res = { ...byFile, ...res };
    }
  }
  return res;
}

export function getTitleImagePrefs(profile, titleId) {
  return getImagePrefs(profile, titleId);
}

export function syncImagePrefsWithRemote(profile, remotePrefs) {
  const local = readLocal(profile);
  const remote = remotePrefs && typeof remotePrefs === 'object' ? remotePrefs : {};
  const merged = { ...local };

  for (const [titleId, rPref] of Object.entries(remote)) {
    if (!rPref) continue;
    const lPref = merged[titleId];
    if (!lPref) {
      merged[titleId] = rPref;
    } else {
      const lTime = lPref.updated_at || 0;
      const rTime = rPref.updated_at || 0;
      if (rTime >= lTime) {
        merged[titleId] = {
          ...lPref,
          ...rPref,
          poster: rPref.poster !== undefined ? rPref.poster : lPref.poster,
          backdrop: rPref.backdrop !== undefined ? rPref.backdrop : lPref.backdrop,
          logo: rPref.logo !== undefined ? rPref.logo : lPref.logo,
          updated_at: rTime || Date.now(),
        };
      } else {
        merged[titleId] = {
          ...rPref,
          ...lPref,
          poster: lPref.poster !== undefined ? lPref.poster : rPref.poster,
          backdrop: lPref.backdrop !== undefined ? lPref.backdrop : rPref.backdrop,
          logo: lPref.logo !== undefined ? lPref.logo : rPref.logo,
          updated_at: lTime || Date.now(),
        };
      }
    }
  }

  saveLocalImagePrefs(profile, merged);
  return merged;
}

// kind: 'poster' | 'backdrop' | 'logo'; url = '' restaura la imagen original.
export function setImagePref(profile, title, kind, url, sync) {
  const titleId = String(typeof title === 'object' && title ? title.id : title);
  const next = { ...getImagePrefs(profile, titleId), updated_at: Date.now() };
  if (url) next[kind] = url; else delete next[kind];

  if (profile) {
    if (!profile.image_prefs) profile.image_prefs = {};
    profile.image_prefs[titleId] = next;
    if (typeof title === 'object' && title?.tmdbId) {
      profile.image_prefs[String(title.tmdbId)] = next;
    }
  }
  const local = readLocal(profile);
  local[titleId] = next;
  if (typeof title === 'object' && title?.tmdbId) {
    local[String(title.tmdbId)] = next;
  }
  writeLocal(profile, local);

  try {
    if (sync?.schedulePush && profile?.id) {
      sync.schedulePush({
        profile,
        progress: loadProgress(profile.id),
        favorites: loadFavorites(profile.id),
        image_prefs: profile.image_prefs
      });
    }
  } catch (_) {}
  return next;
}

// Aplica las imágenes elegidas sobre t.metadata (devuelve true si cambió algo).
export function applyImagePrefs(t, profile) {
  if (!t || !profile) return false;
  const prefs = getImagePrefs(profile, t);
  let changed = false;

  if (prefs.poster) {
    t.customPoster = prefs.poster;
    t.poster = prefs.poster;
    if (t.metadata) t.metadata.poster = prefs.poster;
    changed = true;
  }
  if (prefs.backdrop) {
    t.customBackdrop = prefs.backdrop;
    t.backdrop = prefs.backdrop;
    if (t.metadata) t.metadata.backdrop = prefs.backdrop;
    changed = true;
  }
  if (prefs.logo) {
    t.customLogo = prefs.logo;
    t.logo = prefs.logo;
    if (t.metadata) t.metadata.logo = prefs.logo;
    changed = true;
  }

  for (const kind of Object.keys(IMAGE_KINDS)) {
    if (prefs[kind] && t.metadata && t.metadata[kind] !== prefs[kind]) {
      t._origImages = t._origImages || {};
      if (!(kind in t._origImages)) t._origImages[kind] = t.metadata[kind];
      t.metadata = { ...t.metadata, [kind]: prefs[kind] };
      changed = true;
    }
  }
  return changed;
}

// Devuelve la imagen original de TMDB (la anterior a la elección del usuario).
export function restoreOriginalImage(t, kind) {
  if (t?.metadata && t._origImages && kind in t._origImages) {
    t.metadata = { ...t.metadata, [kind]: t._origImages[kind] };
    delete t._origImages[kind];
  }
}
