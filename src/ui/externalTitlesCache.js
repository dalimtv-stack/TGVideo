// src/ui/externalTitlesCache.js
// Caché en memoria para títulos derivados de canales externos y gestión de archivos ocultos (gestionados).
import { createKV } from '../core/kv.js';

const kv = createKV();
const EXT_HIDDEN_KEY = 'ext_hidden_files_v1';
export const EXT_CHANNEL_TITLES_CACHE = new Map();

export function clearExternalChannelCache(channelId) {
  if (channelId) {
    EXT_CHANNEL_TITLES_CACHE.delete(String(channelId));
    return;
  }
  EXT_CHANNEL_TITLES_CACHE.clear();
}

// Conjunto en memoria de claves de archivos ocultos en canales externos
let hiddenKeysSet = null;

function normalizeFileKey(f) {
  if (!f) return '';
  if (typeof f === 'string') return f.trim();
  const k = f.key || (f.channelId && f.messageId ? `${f.channelId}:${f.messageId}` : '');
  return String(k || '').trim();
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
        const raw = localStorage.getItem('tg_ext_hidden_keys_v1');
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
    // Si aún no se ha cargado en memoria, comprobar localStorage de forma síncrona inmediata
    try {
      const raw = localStorage.getItem('tg_ext_hidden_keys_v1');
      if (raw) hiddenKeysSet = new Set(JSON.parse(raw));
    } catch (_) {}
  }
  if (!hiddenKeysSet || hiddenKeysSet.size === 0) return false;

  const k = normalizeFileKey(fileOrKey);
  if (k && hiddenKeysSet.has(k)) return true;

  if (typeof fileOrKey === 'object' && fileOrKey !== null) {
    const chId = String(fileOrKey.channelId || fileOrKey.channel?.id || '');
    const msgId = String(fileOrKey.messageId || '');
    if (chId && msgId) {
      if (hiddenKeysSet.has(`${chId}:${msgId}`)) return true;
      const rawCh = chId.replace(/^ext-/, '');
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
    if (typeof item === 'object' && item !== null) {
      const chId = String(item.channelId || item.channel?.id || '');
      const msgId = String(item.messageId || '');
      if (chId && msgId) {
        const rawCh = chId.replace(/^ext-/, '');
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
    try { localStorage.setItem('tg_ext_hidden_keys_v1', JSON.stringify(arr)); } catch (_) {}
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
    if (typeof item === 'object' && item !== null) {
      const chId = String(item.channelId || item.channel?.id || '');
      const msgId = String(item.messageId || '');
      if (chId && msgId) {
        const rawCh = chId.replace(/^ext-/, '');
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
    try { localStorage.setItem('tg_ext_hidden_keys_v1', JSON.stringify(arr)); } catch (_) {}
  }
  return set;
}
