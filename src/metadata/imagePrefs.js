// src/metadata/imagePrefs.js
// Imágenes elegidas por el usuario (cartel / fondo / logo) para cada título.
//
// Modelo de datos (por perfil, viaja en la sincronización):
//   image_prefs[clave] = {
//     poster, backdrop, logo,                 // URL elegida, o '' = "restaurar original" (lápida)
//     ts: { poster, backdrop, logo },         // marca de tiempo propia de cada tipo de imagen
//     updated_at                              // máximo de las anteriores (compatibilidad)
//   }
// Cada tipo de imagen se fusiona de forma independiente: gana la modificación más reciente.
// Así un dispositivo con datos antiguos nunca pisa un cambio nuevo ni "resucita" imágenes restauradas.
//
// Claves (alias) con las que se guarda un título: su id y `tmdb:<tipo>:<id>`.
// Se siguen LEYENDO las claves antiguas (`<tmdbId>`, `tmdb:<id>`, `canal:mensaje`) por compatibilidad.
import { loadProgress, loadFavorites } from '../player/progress.js';

export const IMAGE_KINDS = { poster: 'Cartel', backdrop: 'Fondo', logo: 'Logo' };
const KINDS = Object.keys(IMAGE_KINDS);

const storeKey = (profile) => `tgvideo_imgprefs_${profile?.id || 'default'}`;

// ---------------------------------------------------------------- almacenamiento local

export function readLocal(profile) {
  try { return JSON.parse(localStorage.getItem(storeKey(profile)) || '{}') || {}; } catch (_) { return {}; }
}

export function writeLocal(profile, data) {
  try { localStorage.setItem(storeKey(profile), JSON.stringify(data)); } catch (_) {}
}

// ---------------------------------------------------------------- fusión

function kindTs(entry, kind) {
  if (!entry || entry[kind] === undefined) return 0;
  const own = entry.ts?.[kind];
  if (Number.isFinite(own)) return own;
  return Number(entry.updated_at) || 0; // entradas antiguas sin marca por tipo
}

function normalizeEntry(e) {
  const out = { ts: {} };
  let max = 0;
  for (const k of KINDS) {
    if (e[k] === undefined) continue;
    out[k] = e[k];
    out.ts[k] = kindTs(e, k);
    max = Math.max(max, out.ts[k]);
  }
  out.updated_at = Math.max(max, Number(e.updated_at) || 0);
  return out;
}

/** Fusiona dos entradas: para cada tipo gana la marca de tiempo más reciente. */
export function mergeEntry(a, b) {
  if (!a) return b ? normalizeEntry(b) : null;
  if (!b) return normalizeEntry(a);
  const out = { ts: {} };
  let max = 0;
  for (const k of KINDS) {
    if (a[k] === undefined && b[k] === undefined) continue;
    const ta = kindTs(a, k);
    const tb = kindTs(b, k);
    const pick = tb > ta ? b : a;
    if (pick[k] === undefined) continue;
    out[k] = pick[k];
    out.ts[k] = Math.max(ta, tb);
    max = Math.max(max, out.ts[k]);
  }
  out.updated_at = Math.max(max, Number(a.updated_at) || 0, Number(b.updated_at) || 0);
  return out;
}

/** Fusiona dos mapas completos de preferencias. */
export function mergeImagePrefMaps(a = {}, b = {}) {
  const out = {};
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const key of keys) {
    const m = mergeEntry(a?.[key], b?.[key]);
    if (m) out[key] = m;
  }
  return out;
}

/** true si `a` contiene algún cambio más reciente que lo que hay en `b`. */
export function hasNewerThan(a = {}, b = {}) {
  for (const [key, entry] of Object.entries(a || {})) {
    for (const k of KINDS) {
      if (entry?.[k] === undefined) continue;
      const other = b?.[key];
      if (!other || other[k] === undefined || kindTs(entry, k) > kindTs(other, k)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- lectura y caché

let cachedMergedPrefs = new Map();

export function clearImagePrefsCache(profileId) {
  if (profileId) cachedMergedPrefs.delete(String(profileId));
  else cachedMergedPrefs.clear();
}

/** Mapa completo (memoria del perfil + caché del dispositivo) ya fusionado. */
export function readImagePrefs(profile) {
  if (!profile) return {};
  const pid = String(profile.id || 'default');
  const inMem = profile?.image_prefs && typeof profile.image_prefs === 'object' ? profile.image_prefs : null;
  const cached = cachedMergedPrefs.get(pid);
  if (cached && cached.inMem === inMem) {
    return cached.merged;
  }
  const local = readLocal(profile);
  const merged = mergeImagePrefMaps(local, inMem || {});
  cachedMergedPrefs.set(pid, { inMem, merged });
  return merged;
}

export function saveLocalImagePrefs(profile, prefs) {
  writeLocal(profile, prefs);
  if (profile) {
    profile.image_prefs = prefs;
    cachedMergedPrefs.set(String(profile.id || 'default'), { inMem: prefs, merged: prefs });
  }
  return prefs;
}

function typeOf(t) {
  if (!t || typeof t !== 'object') return 'movie';
  if (t.isSaga || t.metadata?.type === 'collection') return 'collection';
  if (t.tipo === 'serie' || t.metadata?.type === 'tv') return 'tv';
  return 'movie';
}

const tmdbAlias = (t) => {
  const id = t?.metadata?.id || t?.tmdbId;
  return id ? `tmdb:${typeOf(t)}:${id}` : null;
};

/**
 * Claves en las que puede estar guardada la elección de un título.
 * - Colecciones/sagas y series: SOLO su propio id y su alias TMDB tipado.
 * - Películas: además las claves antiguas (`tmdb:<id>`, `<id>`) y las de sus archivos (versiones).
 */
function candidateKeys(titleOrId) {
  if (typeof titleOrId === 'string' || typeof titleOrId === 'number') return [String(titleOrId)];
  const t = titleOrId;
  const keys = [];
  if (t.id != null) keys.push(String(t.id));
  const alias = tmdbAlias(t);
  if (alias) keys.push(alias);
  if (typeOf(t) !== 'movie') return [...new Set(keys)];

  const tmdb = t.metadata?.id || t.tmdbId;
  if (tmdb) {
    keys.push(`tmdb:${tmdb}`);   // formato antiguo
    keys.push(String(tmdb));     // formato antiguo
  }
  for (const f of (t.archivos || [])) {
    const ch = f.channel && typeof f.channel === 'object' ? f.channel.id : f.channel;
    if (ch != null && f.messageId != null) keys.push(`${ch}:${f.messageId}`);
  }
  return [...new Set(keys)];
}

function rawEntryFor(profile, titleOrId) {
  const all = readImagePrefs(profile);
  if (!all || !Object.keys(all).length) return null;
  const keys = candidateKeys(titleOrId);
  let res = null;
  for (const k of keys) {
    if (k in all) {
      res = mergeEntry(res, all[k]);
    }
  }
  return res || { ts: {}, updated_at: 0 };
}

/** Devuelve { poster?, backdrop?, logo? } con las URL elegidas (sin lápidas). */
export function getImagePrefs(profile, titleOrId) {
  if (!profile || !titleOrId) return {};
  const e = rawEntryFor(profile, titleOrId);
  if (!e) return {};
  const out = {};
  for (const k of KINDS) if (e[k]) out[k] = e[k];
  return out;
}

export function getTitleImagePrefs(profile, titleId) {
  return getImagePrefs(profile, titleId);
}

// ---------------------------------------------------------------- sincronización

/** Fusiona lo recibido de Telegram con lo local y lo deja guardado. */
export function syncImagePrefsWithRemote(profile, remotePrefs) {
  const remote = remotePrefs && typeof remotePrefs === 'object' ? remotePrefs : {};
  const merged = mergeImagePrefMaps(readImagePrefs(profile), remote);
  saveLocalImagePrefs(profile, merged);
  return merged;
}

/**
 * Descarga el archivo dedicado de imágenes del perfil (imgprefs_*), lo fusiona con lo recibido en el
 * perfil y con lo local, y lo sube si este dispositivo aporta cambios más recientes.
 */
export async function pullAndMergeImagePrefs(profile, sync, fromProfileFile = {}) {
  if (!profile) return {};
  let remote = fromProfileFile && typeof fromProfileFile === 'object' ? fromProfileFile : {};
  if (sync?.pullImagePrefs && profile.id) {
    try {
      const dedicated = await sync.pullImagePrefs(profile.id);
      if (dedicated) remote = mergeImagePrefMaps(remote, dedicated);
    } catch (e) { console.warn('[imagePrefs] no se pudo leer imgprefs', e); }
  }
  const merged = syncImagePrefsWithRemote(profile, remote);
  if (sync?.pushImagePrefs && profile.id && hasNewerThan(merged, remote)) {
    sync.pushImagePrefs(profile.id, merged).catch((e) => console.warn('[imagePrefs] push falló', e));
  }
  return merged;
}

const pushTimers = new Map();
function schedulePrefsPush(profile, sync) {
  if (!profile?.id) return;
  if (sync?.pushImagePrefs) {
    clearTimeout(pushTimers.get(profile.id));
    pushTimers.set(profile.id, setTimeout(() => {
      pushTimers.delete(profile.id);
      sync.pushImagePrefs(profile.id, readImagePrefs(profile))
        .catch((e) => console.warn('[imagePrefs] push falló (se reintentará en la próxima sincronización)', e));
    }, 600));
  }
  // Copia dentro del perfil (compatibilidad con versiones anteriores)
  try {
    sync?.schedulePush?.({
      profile,
      progress: loadProgress(profile.id),
      favorites: loadFavorites(profile.id),
      image_prefs: profile.image_prefs,
    });
  } catch (_) {}
}

// ---------------------------------------------------------------- escritura

/**
 * kind: 'poster' | 'backdrop' | 'logo'; url = '' restaura la imagen original.
 * `title` debe ser el objeto del título (así se guardan también los alias por TMDB).
 */
export function setImagePref(profile, title, kind, url, sync) {
  if (!profile || !KINDS.includes(kind)) return null;
  const obj = title && typeof title === 'object' ? title : { id: title };
  const now = Date.now();
  const keys = [String(obj.id), tmdbAlias(obj)].filter(Boolean);

  const local = readImagePrefs(profile);
  let current = null;
  for (const k of candidateKeys(obj)) {
    if (k in local) current = mergeEntry(current, local[k]);
  }
  const next = { ...(current || {}), ts: { ...(current?.ts || {}) } };
  next[kind] = url || '';        // '' = lápida: "restaurar original"
  next.ts[kind] = now;
  next.updated_at = now;

  for (const k of keys) local[k] = mergeEntry(local[k], next);
  saveLocalImagePrefs(profile, local);
  schedulePrefsPush(profile, sync);
  return next;
}

function clearCustomFields(t, kind) {
  const map = { poster: ['customPoster', 'poster'], backdrop: ['customBackdrop', 'backdrop'], logo: ['customLogo', 'logo'] };
  for (const f of map[kind] || []) delete t[f];
}

/**
 * Aplica las imágenes elegidas sobre t.metadata SIN mutar el objeto original
 * (puede ser compartido con la caché, los overrides sincronizados o varios títulos).
 * Devuelve true si cambió algo.
 */
function applyToOne(t, profile) {
  if (!t || !profile) return false;
  const prefs = getImagePrefs(profile, t);
  if (!prefs || !Object.keys(prefs).length) {
    if (!t._origImages || !Object.keys(t._origImages).length) return false;
  }
  let changed = false;

  for (const kind of KINDS) {
    const url = prefs[kind];
    const custom = `custom${kind[0].toUpperCase()}${kind.slice(1)}`;
    if (url) {
      if (t.metadata && t.metadata[kind] !== url) {
        t._origImages = t._origImages || {};
        t._origImages[kind] = t.metadata[kind];      // original (metadato "limpio")
        t.metadata = { ...t.metadata, [kind]: url };
        changed = true;
      }
      if (t[kind] !== url) { t[kind] = url; changed = true; }
      t[custom] = url;
    } else if (t._origImages && kind in t._origImages) {
      // El usuario restauró el original (aquí o en otro dispositivo). Solo se revierte si el metadato
      // sigue mostrando la imagen elegida; si ya se recargó "limpio", basta con olvidar el original.
      if (t.metadata && (t[custom] === undefined || t.metadata[kind] === t[custom])) restoreOriginalImage(t, kind);
      else { delete t._origImages[kind]; clearCustomFields(t, kind); }
      changed = true;
    }
  }
  return changed;
}

/**
 * Aplica las imágenes elegidas al título y, si es una saga, también a cada una de sus películas
 * (cada película usa su propia elección, igual que en su ficha individual y en la home).
 */
export function applyImagePrefs(t, profile) {
  let changed = applyToOne(t, profile);
  if (t?.isSaga && Array.isArray(t.archivos)) {
    for (const f of t.archivos) {
      if (!f.metadata) continue;
      const film = {
        id: f.key || `${f.channelId ?? f.channel?.id ?? ''}:${f.messageId}`,
        tipo: 'pelicula',
        metadata: f.metadata,
        tmdbId: f.tmdbId || f.metadata?.id || null,
        archivos: [f],
        _origImages: f._origImages,
      };
      if (applyToOne(film, profile)) {
        f.metadata = film.metadata;
        f._origImages = film._origImages;
        changed = true;
      }
    }
  }
  return changed;
}

/** Devuelve la imagen original (anterior a la elección del usuario). */
export function restoreOriginalImage(t, kind) {
  if (!t) return;
  if (t.metadata && t._origImages && kind in t._origImages) {
    const orig = t._origImages[kind];
    const meta = { ...t.metadata };
    if (orig === undefined) delete meta[kind]; else meta[kind] = orig;
    t.metadata = meta;
    delete t._origImages[kind];
  }
  clearCustomFields(t, kind);
}

/**
 * Metadatos "limpios" para guardar en la caché local: sin las imágenes elegidas por el usuario,
 * que pertenecen al perfil y se reaplican al cargar.
 */
export function metadataForPersist(t) {
  if (!t?.metadata) return t?.metadata || null;
  if (!t._origImages || !Object.keys(t._origImages).length) return t.metadata;
  const meta = { ...t.metadata };
  for (const [k, v] of Object.entries(t._origImages)) {
    if (v === undefined) delete meta[k]; else meta[k] = v;
  }
  return meta;
}
