// src/metadata/imagePrefs.js
// Imágenes elegidas por el usuario (cartel / fondo / logo) para cada título.
// - Por perfil: profile.image_prefs[titleId] (viaja en la sincronización del perfil).
// - Caché del dispositivo: localStorage `tgvideo_imgprefs_<perfil>` (funciona sin conexión).
import { loadProgress } from '../player/progress.js';

export const IMAGE_KINDS = { poster: 'Cartel', backdrop: 'Fondo', logo: 'Logo' };

const storeKey = (profile) => `tgvideo_imgprefs_${profile?.id || 'default'}`;

export function readLocal(profile) {
  try { return JSON.parse(localStorage.getItem(storeKey(profile)) || '{}') || {}; } catch (_) { return {}; }
}

export function writeLocal(profile, data) {
  try { localStorage.setItem(storeKey(profile), JSON.stringify(data)); } catch (_) {}
}

export function readImagePrefs(profile) {
  if (profile?.image_prefs && typeof profile.image_prefs === 'object') {
    return profile.image_prefs;
  }
  return readLocal(profile);
}

export function saveLocalImagePrefs(profile, prefs) {
  writeLocal(profile, prefs);
  if (profile) {
    profile.image_prefs = prefs;
  }
  return prefs;
}

export function getImagePrefs(profile, titleId) {
  const id = String(titleId);
  const fromProfile = profile?.image_prefs?.[id] || {};
  const fromLocal = readLocal(profile)[id] || {};
  // Gana la más reciente
  return (fromLocal.updated_at || 0) > (fromProfile.updated_at || 0) ? fromLocal : fromProfile;
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
          poster: rPref.poster || lPref.poster,
          backdrop: rPref.backdrop || lPref.backdrop,
          logo: rPref.logo || lPref.logo,
          updated_at: rTime || Date.now(),
        };
      } else {
        merged[titleId] = {
          ...rPref,
          ...lPref,
          poster: lPref.poster || rPref.poster,
          backdrop: lPref.backdrop || rPref.backdrop,
          logo: lPref.logo || rPref.logo,
          updated_at: lTime || Date.now(),
        };
      }
    }
  }

  saveLocalImagePrefs(profile, merged);
  return merged;
}

// kind: 'poster' | 'backdrop' | 'logo'; url = '' restaura la imagen original.
export function setImagePref(profile, titleId, kind, url, sync) {
  const id = String(titleId);
  const next = { ...getImagePrefs(profile, id), updated_at: Date.now() };
  if (url) next[kind] = url; else delete next[kind];

  if (profile) {
    if (!profile.image_prefs) profile.image_prefs = {};
    profile.image_prefs[id] = next;
  }
  const local = readLocal(profile);
  local[id] = next;
  writeLocal(profile, local);

  try {
    if (sync?.schedulePush && profile?.id) {
      sync.schedulePush({
        profile,
        progress: loadProgress(profile.id),
        image_prefs: profile.image_prefs
      });
    }
  } catch (_) {}
  return next;
}

// Aplica las imágenes elegidas sobre t.metadata (devuelve true si cambió algo).
export function applyImagePrefs(t, profile) {
  if (!t || !profile) return false;
  const prefs = getImagePrefs(profile, t.id);
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
