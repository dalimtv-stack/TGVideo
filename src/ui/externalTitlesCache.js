// src/ui/externalTitlesCache.js
// Caché en memoria para títulos derivados de canales externos, gestión de archivos ocultos y overrides de episodios.
import { createKV } from "../core/kv.js";

const kv = createKV();
const EXT_HIDDEN_KEY = "ext_hidden_files_v1";
const EPISODE_OVERRIDES_KEY = "tgv_episode_overrides_v1";

export const EXT_CHANNEL_TITLES_CACHE = new Map();
const episodeOverridesMap = new Map();

export function clearExternalChannelCache(channelId) {
  if (channelId) {
    EXT_CHANNEL_TITLES_CACHE.delete(String(channelId));
    return;
  }
  EXT_CHANNEL_TITLES_CACHE.clear();
}

let hiddenKeysSet = null;

function normalizeFileKey(f) {
  if (!f) return "";
  if (typeof f === "string") return f.trim();
  const k = f.key || (f.channelId && f.messageId ? `${f.channelId}:${f.messageId}` : "");
  return String(k || "").trim();
}

/**
 * Carga de forma asíncrona las claves de archivos ocultos desde IndexedDB/localStorage.
 */
export async function getHiddenExternalKeys() {
  if (hiddenKeysSet) return hiddenKeysSet;
  try {
    const fromKv = (await kv.get(EXT_HIDDEN_KEY).catch(() => null)) || [];
    const fromLs = (() => {
      try {
        const raw = localStorage.getItem("tg_ext_hidden_keys_v1");
        return raw ? JSON.parse(raw) : [];
      } catch (_) { return []; }
    })();
    const merged = new Set([...(Array.isArray(fromKv) ? fromKv : []), ...(Array.isArray(fromLs) ? fromLs : [])]);
    hiddenKeysSet = merged;
  } catch (_) {
    hiddenKeysSet = new Set();
  }
  return hiddenKeysSet;
}

/**
 * Comprueba de forma síncrona si un archivo de un canal externo está marcado como oculto.
 */
export function isExternalFileHiddenSync(fileOrKey) {
  if (!hiddenKeysSet) {
    try {
      const raw = localStorage.getItem("tg_ext_hidden_keys_v1");
      if (raw) hiddenKeysSet = new Set(JSON.parse(raw));
    } catch (_) {}
  }
  if (!hiddenKeysSet || hiddenKeysSet.size === 0) return false;

  const k = normalizeFileKey(fileOrKey);
  if (k && hiddenKeysSet.has(k)) return true;

  if (typeof fileOrKey === "object" && fileOrKey !== null) {
    const chId = String(fileOrKey.channelId || fileOrKey.channel?.id || "");
    const msgId = String(fileOrKey.messageId || "");
    if (chId && msgId) {
      if (hiddenKeysSet.has(`${chId}:${msgId}`)) return true;
      const rawCh = chId.replace(/^ext-/, "");
      if (hiddenKeysSet.has(`${rawCh}:${msgId}`)) return true;
      if (hiddenKeysSet.has(`ext-${rawCh}:${msgId}`)) return true;
    }
  }
  return false;
}

/**
 * Marca uno o varios archivos externos como ocultos (gestionados).
 */
export async function hideExternalFiles(filesOrKeys) {
  const set = await getHiddenExternalKeys();
  const list = Array.isArray(filesOrKeys) ? filesOrKeys : [filesOrKeys];
  let changed = false;

  for (const item of list) {
    if (!item) continue;
    const k = normalizeFileKey(item);
    if (k && !set.has(k)) {
      set.add(k);
      changed = true;
    }
    if (typeof item === "object" && item !== null) {
      const chId = String(item.channelId || item.channel?.id || "");
      const msgId = String(item.messageId || "");
      if (chId && msgId) {
        const rawCh = chId.replace(/^ext-/, "");
        set.add(`${chId}:${msgId}`);
        set.add(`${rawCh}:${msgId}`);
        set.add(`ext-${rawCh}:${msgId}`);
        changed = true;
      }
    }
  }

  if (changed) {
    const arr = Array.from(set);
    await kv.set(EXT_HIDDEN_KEY, arr).catch(console.warn);
    try { localStorage.setItem("tg_ext_hidden_keys_v1", JSON.stringify(arr)); } catch (_) {}
  }
  return set;
}

/**
 * Desoculta uno o varios archivos externos.
 */
export async function unhideExternalFiles(filesOrKeys) {
  const set = await getHiddenExternalKeys();
  const list = Array.isArray(filesOrKeys) ? filesOrKeys : [filesOrKeys];
  let changed = false;

  for (const item of list) {
    if (!item) continue;
    const k = normalizeFileKey(item);
    if (k && set.has(k)) {
      set.delete(k);
      changed = true;
    }
    if (typeof item === "object" && item !== null) {
      const chId = String(item.channelId || item.channel?.id || "");
      const msgId = String(item.messageId || "");
      if (chId && msgId) {
        const rawCh = chId.replace(/^ext-/, "");
        set.delete(`${chId}:${msgId}`);
        set.delete(`${rawCh}:${msgId}`);
        set.delete(`ext-${rawCh}:${msgId}`);
        changed = true;
      }
    }
  }

  if (changed) {
    const arr = Array.from(set);
    await kv.set(EXT_HIDDEN_KEY, arr).catch(console.warn);
    try { localStorage.setItem("tg_ext_hidden_keys_v1", JSON.stringify(arr)); } catch (_) {}
  }
  return set;
}

/**
 * Obtiene la corrección manual (temporada, episodio, título opcional) para un archivo.
 */
export function getEpisodeOverride(fileOrKey) {
  if (!fileOrKey) return null;
  if (episodeOverridesMap.size === 0) {
    try {
      const raw = localStorage.getItem(EPISODE_OVERRIDES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const [k, v] of Object.entries(parsed)) episodeOverridesMap.set(k, v);
      }
    } catch (_) {}
  }

  if (typeof fileOrKey === "string") {
    return episodeOverridesMap.get(fileOrKey) || null;
  }

  const f = fileOrKey;
  if (f.key && episodeOverridesMap.has(f.key)) return episodeOverridesMap.get(f.key);

  const chId = String(f.channelId || f.channel?.id || "").trim();
  const msgId = String(f.messageId || "").trim();
  if (chId && msgId) {
    const rawCh = chId.replace(/^ext-/, "");
    const cand = episodeOverridesMap.get(`${chId}:${msgId}`)
      || episodeOverridesMap.get(`${rawCh}:${msgId}`)
      || episodeOverridesMap.get(`ext-${rawCh}:${msgId}`);
    if (cand) return cand;
  }
  return null;
}

/**
 * Aplica los overrides manuales existentes a una lista de archivos.
 */
export function applyEpisodeOverrides(files) {
  if (!Array.isArray(files)) return;
  for (const f of files) {
    if (!f) continue;
    const ov = getEpisodeOverride(f);
    if (ov) {
      if (Number.isInteger(ov.season)) f.season = ov.season;
      if (Number.isInteger(ov.episode)) f.episode = ov.episode;
      f.episodeOverride = ov;
      if (ov.name) {
        f.metadata = { ...(f.metadata || {}), name: ov.name };
      }
    }
  }
}

/**
 * Guarda localmente la corrección de temporada/episodio de un archivo.
 * Persiste en localStorage, IndexedDB (kv), library_v2, ext_files_* y en memoria.
 */
export async function saveEpisodeOverride({ title, file, season, episode, name = null }) {
  const s = Number(season);
  const ep = Number(episode);
  const overrideData = {
    season: s,
    episode: ep,
    name: name ? String(name).trim() : null,
    updated_at: Date.now(),
  };

  const keys = new Set();
  if (file?.key) keys.add(String(file.key).trim());

  const chId = String(file?.channelId || file?.channel?.id || title?.channel?.id || title?.origen?.channelId || "").trim();
  const msgId = String(file?.messageId || "").trim();
  if (chId && msgId) {
    keys.add(`${chId}:${msgId}`);
    const rawCh = chId.replace(/^ext-/, "");
    if (rawCh) {
      keys.add(`${rawCh}:${msgId}`);
      keys.add(`ext-${rawCh}:${msgId}`);
    }
  }
  const titleId = String(title?.id || "").trim();
  if (titleId && msgId) {
    keys.add(`${titleId}:${msgId}`);
    const rawT = titleId.replace(/^ext-/, "");
    if (rawT) keys.add(`${rawT}:${msgId}`);
  }

  for (const k of keys) {
    episodeOverridesMap.set(k, overrideData);
  }

  try {
    const raw = localStorage.getItem(EPISODE_OVERRIDES_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    for (const k of keys) stored[k] = overrideData;
    localStorage.setItem(EPISODE_OVERRIDES_KEY, JSON.stringify(stored));
  } catch (_) {}

  try {
    const kvStored = (await kv.get(EPISODE_OVERRIDES_KEY).catch(() => ({}))) || {};
    for (const k of keys) kvStored[k] = overrideData;
    await kv.set(EPISODE_OVERRIDES_KEY, kvStored).catch(() => {});
  } catch (_) {}

  try {
    const lib = await kv.get("library_v2").catch(() => null);
    if (lib) {
      lib.episodeOverrides = lib.episodeOverrides || {};
      for (const k of keys) lib.episodeOverrides[k] = { season: s, episode: ep, name: overrideData.name };
      await kv.set("library_v2", lib).catch(() => {});
    }
  } catch (_) {}

  const channelCandidates = [chId, chId.replace(/^ext-/, ""), `ext-${chId.replace(/^ext-/, "")}`].filter(Boolean);
  for (const cId of channelCandidates) {
    try {
      const extFiles = await kv.get(`ext_files_${cId}`).catch(() => null);
      if (Array.isArray(extFiles) && extFiles.length > 0) {
        let touched = false;
        for (const ef of extFiles) {
          if (String(ef.messageId) === msgId || ef.key === file?.key || keys.has(ef.key)) {
            ef.season = s;
            ef.episode = ep;
            ef.episodeOverride = overrideData;
            touched = true;
          }
        }
        if (touched) await kv.set(`ext_files_${cId}`, extFiles).catch(() => {});
      }
    } catch (_) {}
  }

  for (const cId of channelCandidates) {
    const cachedTitles = EXT_CHANNEL_TITLES_CACHE.get(cId);
    if (Array.isArray(cachedTitles)) {
      for (const ct of cachedTitles) {
        if (Array.isArray(ct.archivos)) {
          for (const cf of ct.archivos) {
            if (String(cf.messageId) === msgId || cf.key === file?.key || keys.has(cf.key)) {
              cf.season = s;
              cf.episode = ep;
              cf.episodeOverride = overrideData;
            }
          }
        }
      }
    }
  }

  if (file) {
    file.season = s;
    file.episode = ep;
    file.episodeOverride = overrideData;
    if (overrideData.name) {
      file.metadata = { ...(file.metadata || {}), name: overrideData.name };
    }
  }
}
