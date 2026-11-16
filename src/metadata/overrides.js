// src/metadata/overrides.js
/**
 * Identificaciones manuales sincronizadas entre dispositivos.
 * Se guardan en el canal Perfiles::TGVideo::tgstorage como metadata_overrides_{ts}.json
 * Clave: title.id (id de canal, o "idCanal:idMensaje" para películas en canales por año).
 */
import { createKV } from '../core/kv.js';

const kv = createKV();
const KV_KEY = 'metadata_overrides_v1';
let state = { v: 1, updated_at: 0, overrides: {} };
let syncRef = null;
let pushTimer = null;

export function getOverride(key) {
  return key != null ? state.overrides[String(key)] || null : null;
}

/** Busca un override por ID de TMDB (útil para reenvíos con otro messageId). */
export function getOverrideByTmdbId(tmdbId) {
  if (tmdbId == null || tmdbId === '') return null;
  const want = String(tmdbId);
  for (const v of Object.values(state.overrides || {})) {
    if (v && String(v.id) === want) return v;
  }
  return null;
}

export async function loadOverrides(sync) {
  syncRef = sync || syncRef;
  const local = await kv.get(KV_KEY).catch(() => null);
  if (local?.overrides) state = local;
  if (!syncRef?.pullMetadataOverrides) return state;
  try {
    const remote = await syncRef.pullMetadataOverrides();
    if (remote?.overrides) {
      // Fusión: por entrada gana la más reciente
      const merged = { ...state.overrides };
      for (const [k, v] of Object.entries(remote.overrides)) {
        const l = merged[k];
        if (!l || (v?.updated_at || 0) >= (l?.updated_at || 0)) merged[k] = v;
      }
      state = { v: 1, updated_at: Math.max(state.updated_at || 0, remote.updated_at || 0), overrides: merged };
      await kv.set(KV_KEY, state).catch(() => {});
    }
  } catch (e) {
    console.warn('[overrides] No se pudieron leer de Telegram', e);
  }
  return state;
}

function schedulePush() {
  if (!syncRef?.pushMetadataOverrides) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    syncRef.pushMetadataOverrides(state).catch(e => console.warn('[overrides] push falló', e));
  }, 1500);
}

export async function setOverride(key, meta, sync) {
  if (sync) syncRef = sync;
  const now = Date.now();
  state.overrides[String(key)] = { ...meta, rating: Number(meta?.rating) || 0, updated_at: now };
  state.updated_at = now;
  await kv.set(KV_KEY, state).catch(() => {});
  schedulePush();
}

export async function removeOverride(key, sync) {
  if (sync) syncRef = sync;
  if (!state.overrides[String(key)]) return;
  delete state.overrides[String(key)];
  state.updated_at = Date.now();
  await kv.set(KV_KEY, state).catch(() => {});
  schedulePush();
}
