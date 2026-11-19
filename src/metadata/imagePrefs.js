// src/metadata/imagePrefs.js
// Imágenes elegidas por el usuario (cartel / fondo / logo) para cada título.
// - Por perfil: profile.image_prefs[titleId] (viaja en la sincronización del perfil).
// - Caché del dispositivo: localStorage `tgvideo_imgprefs_<perfil>` (funciona sin conexión).
import { loadProgress } from '../player/progress.js';

export const IMAGE_KINDS = { poster: 'Cartel', backdrop: 'Fondo', logo: 'Logo' };

const storeKey = (profile) => `tgvideo_imgprefs_${profile?.id || 'default'}`;

function readLocal(profile) {
  try { return JSON.parse(localStorage.getItem(storeKey(profile)) || '{}') || {}; } catch (_) { return {}; }
}

function writeLocal(profile, data) {
  try { localStorage.setItem(storeKey(profile), JSON.stringify(data)); } catch (_) {}
}

export function getImagePrefs(profile, titleId) {
  const id = String(titleId);
  const fromProfile = profile?.image_prefs?.[id] || {};
  const fromLocal = readLocal(profile)[id] || {};
  // Gana la más reciente
  return (fromLocal.updated_at || 0) > (fromProfile.updated_at || 0) ? fromLocal : fromProfile;
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
      sync.schedulePush({ profile, progress: loadProgress(profile.id) });
    }
  } catch (_) {}
  return next;
}

// Aplica las imágenes elegidas sobre t.metadata (devuelve true si cambió algo).
export function applyImagePrefs(t, profile) {
  if (!t?.metadata || !profile) return false;
  const prefs = getImagePrefs(profile, t.id);
  let changed = false;
  for (const kind of Object.keys(IMAGE_KINDS)) {
    if (prefs[kind] && t.metadata[kind] !== prefs[kind]) {
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
