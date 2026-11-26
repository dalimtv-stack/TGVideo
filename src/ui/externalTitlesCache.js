// src/ui/externalTitlesCache.js
// Caché en memoria para títulos derivados de canales externos, gestión de archivos ocultos, overrides de episodios y reubicación manual de episodios entre series.
import { createKV } from "../core/kv.js";

const kv = createKV();
const EXT_HIDDEN_KEY = "ext_hidden_files_v1";
const EPISODE_OVERRIDES_KEY = "tgv_episode_overrides_v1";
const SERIES_MOVES_KEY = "tgv_series_moves_v1";

export const EXT_CHANNEL_TITLES_CACHE = new Map();
const episodeOverridesMap = new Map();
const seriesMovesMap = new Map();

export function clearExternalChannelCache(channelId) {
  if (channelId) {
    const s = String(channelId);
    const raw = s.replace(/^ext-/, "");
    EXT_CHANNEL_TITLES_CACHE.delete(s);
    EXT_CHANNEL_TITLES_CACHE.delete(raw);
    EXT_CHANNEL_TITLES_CACHE.delete(`ext-${raw}`);
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

/**
 * Carga de forma asíncrona todas las reubicaciones de series guardadas (IndexedDB y localStorage).
 */
export async function loadSeriesMovesAsync() {
  try {
    const rawLs = localStorage.getItem(SERIES_MOVES_KEY);
    if (rawLs) {
      const parsed = JSON.parse(rawLs);
      for (const [k, v] of Object.entries(parsed)) seriesMovesMap.set(k, v);
    }
  } catch (_) {}

  try {
    const fromKv = (await kv.get(SERIES_MOVES_KEY).catch(() => null)) || {};
    if (fromKv && typeof fromKv === "object") {
      for (const [k, v] of Object.entries(fromKv)) seriesMovesMap.set(k, v);
    }
  } catch (_) {}

  try {
    const lib = await kv.get("library_v2").catch(() => null);
    if (lib?.seriesMoves && typeof lib.seriesMoves === "object") {
      for (const [k, v] of Object.entries(lib.seriesMoves)) seriesMovesMap.set(k, v);
    }
  } catch (_) {}

  return seriesMovesMap;
}

/**
 * Obtiene la asignación manual de serie para un episodio (reubicación).
 */
export function getEpisodeSeriesMove(fileOrKey) {
  if (!fileOrKey) return null;
  if (seriesMovesMap.size === 0) {
    try {
      const raw = localStorage.getItem(SERIES_MOVES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const [k, v] of Object.entries(parsed)) seriesMovesMap.set(k, v);
      }
    } catch (_) {}
  }

  if (typeof fileOrKey === "string") {
    return seriesMovesMap.get(fileOrKey) || null;
  }

  const f = fileOrKey;
  if (f.seriesMove) return f.seriesMove;
  if (f.key && seriesMovesMap.has(f.key)) return seriesMovesMap.get(f.key);

  const chId = String(f.channelId || f.channel?.id || "").trim();
  const msgId = String(f.messageId || "").trim();
  if (chId && msgId) {
    const rawCh = chId.replace(/^ext-/, "");
    const cand = seriesMovesMap.get(`${chId}:${msgId}`)
      || seriesMovesMap.get(`${rawCh}:${msgId}`)
      || seriesMovesMap.get(`ext-${rawCh}:${msgId}`);
    if (cand) return cand;
  }
  if (f.captionFileName && seriesMovesMap.has(f.captionFileName)) return seriesMovesMap.get(f.captionFileName);
  if (f.fileName && seriesMovesMap.has(f.fileName)) return seriesMovesMap.get(f.fileName);
  return null;
}

/**
 * Guarda la reubicación manual de un episodio a otra serie existente o nueva.
 * Persiste de inmediato en memoria, localStorage, IndexedDB (kv y library_v2),
 * y en los registros de archivos del canal externo (ext_files_*).
 */
export async function saveEpisodeSeriesMove({ file, sourceTitle, targetTitle, targetSeriesId, targetSeriesName, season, episode }) {
  const s = Number(season) || 1;
  const ep = Number(episode) || 1;
  const targetId = String(targetSeriesId || targetTitle?.id || "").trim();
  const targetName = String(targetSeriesName || targetTitle?.nombre || "").trim();

  const moveData = {
    targetTitleId: targetId,
    targetTitleName: targetName,
    sourceTitleId: sourceTitle ? String(sourceTitle.id || "") : null,
    sourceTitleName: sourceTitle ? String(sourceTitle.nombre || "") : null,
    season: s,
    episode: ep,
    updated_at: Date.now(),
  };

  const keys = new Set();
  if (file?.key) keys.add(String(file.key).trim());

  const chId = String(file?.channelId || file?.channel?.id || sourceTitle?.channel?.id || "").trim();
  const msgId = String(file?.messageId || "").trim();
  if (chId && msgId) {
    keys.add(`${chId}:${msgId}`);
    const rawCh = chId.replace(/^ext-/, "");
    if (rawCh) {
      keys.add(`${rawCh}:${msgId}`);
      keys.add(`ext-${rawCh}:${msgId}`);
    }
  }
  if (file?.fileName) keys.add(String(file.fileName).trim());
  if (file?.captionFileName) keys.add(String(file.captionFileName).trim());

  for (const k of keys) {
    seriesMovesMap.set(k, moveData);
  }

  try {
    const raw = localStorage.getItem(SERIES_MOVES_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    for (const k of keys) stored[k] = moveData;
    localStorage.setItem(SERIES_MOVES_KEY, JSON.stringify(stored));
  } catch (_) {}

  try {
    const kvStored = (await kv.get(SERIES_MOVES_KEY).catch(() => ({}))) || {};
    for (const k of keys) kvStored[k] = moveData;
    await kv.set(SERIES_MOVES_KEY, kvStored).catch(() => {});
  } catch (_) {}

  try {
    const lib = await kv.get("library_v2").catch(() => null);
    if (lib) {
      lib.seriesMoves = lib.seriesMoves || {};
      for (const k of keys) lib.seriesMoves[k] = moveData;
      await kv.set("library_v2", lib).catch(() => {});
    }
  } catch (_) {}

  // Actualizar también en ext_files_* para que cualquier recarga futura preserve la asignación
  const channelCandidates = [chId, chId.replace(/^ext-/, ""), `ext-${chId.replace(/^ext-/, "")}`].filter(Boolean);
  for (const cId of channelCandidates) {
    try {
      const extFiles = await kv.get(`ext_files_${cId}`).catch(() => null);
      if (Array.isArray(extFiles) && extFiles.length > 0) {
        let touched = false;
        for (const ef of extFiles) {
          const match = (msgId && String(ef.messageId) === msgId) || (ef.key && keys.has(ef.key)) || (ef.fileName && keys.has(ef.fileName));
          if (match) {
            ef.season = s;
            ef.episode = ep;
            ef.seriesMove = moveData;
            ef.targetSeriesName = targetName;
            ef.targetSeriesId = targetId;
            touched = true;
          }
        }
        if (touched) await kv.set(`ext_files_${cId}`, extFiles).catch(() => {});
      }
    } catch (_) {}
  }

  // Mantener coherente también el override numérico
  await saveEpisodeOverride({ title: targetTitle || sourceTitle, file, season: s, episode: ep });

  if (file) {
    file.season = s;
    file.episode = ep;
    file.seriesMove = moveData;
  }
  return moveData;
}

/**
 * Aplica las reubicaciones de series a una lista de títulos en memoria.
 */
export function applySeriesMoves(titles) {
  if (!Array.isArray(titles)) return titles;
  if (seriesMovesMap.size === 0) {
    try {
      const raw = localStorage.getItem(SERIES_MOVES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const [k, v] of Object.entries(parsed)) seriesMovesMap.set(k, v);
      }
    } catch (_) {}
  }
  if (seriesMovesMap.size === 0) return titles;

  for (const t of titles) {
    if (!Array.isArray(t.archivos)) continue;
    const toRemove = [];
    for (const f of t.archivos) {
      const move = getEpisodeSeriesMove(f);
      if (move && (move.targetTitleId || move.targetTitleName)) {
        const isCurrentTarget = String(move.targetTitleId) === String(t.id) ||
          (t.tipo === "serie" && t.nombre && move.targetTitleName && t.nombre.toLowerCase().trim() === move.targetTitleName.toLowerCase().trim());
        if (isCurrentTarget) continue;

        toRemove.push(f);
        let target = titles.find(x => String(x.id) === String(move.targetTitleId) || (x.tipo === "serie" && x.nombre && move.targetTitleName && x.nombre.toLowerCase().trim() === move.targetTitleName.toLowerCase().trim()));
        if (!target) {
          target = {
            id: move.targetTitleId || `ext#${move.targetTitleName}`,
            tipo: "serie",
            nombre: move.targetTitleName || "Serie",
            grupo: t.grupo || "Series",
            channel: t.channel,
            origen: t.origen,
            archivos: [],
            ultimoMensajeFecha: f.date || 0,
          };
          titles.push(target);
        }
        if (Number.isInteger(move.season)) f.season = move.season;
        if (Number.isInteger(move.episode)) f.episode = move.episode;
        f.seriesMove = move;
        const alreadyInTarget = target.archivos.some(existing => existing.key === f.key || (f.messageId && String(existing.messageId) === String(f.messageId)));
        if (!alreadyInTarget) {
          target.archivos.push(f);
          target.archivos.sort((a, b) => ((Number(a.season) || 1) - (Number(b.season) || 1)) || ((Number(a.episode) || 1) - (Number(b.episode) || 1)) || (a.date - b.date));
        }
      }
    }
    if (toRemove.length > 0) {
      t.archivos = t.archivos.filter(f => !toRemove.includes(f));
    }
  }

  return titles.filter(t => Array.isArray(t.archivos) && t.archivos.length > 0);
}
