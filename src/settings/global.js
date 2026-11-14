import { createKV } from '../core/kv.js';

const kv = createKV();
const KEY = 'config_global_v1';
let config = { v: 1, tmdb: { apiKey: '' }, updated_at: 0 };

export function getGlobalConfig() { return structuredClone(config); }
export function getTmdbKey() {
  return config.tmdb?.apiKey || import.meta.env?.VITE_TMDB_DEMO_API_KEY || '';
}
export async function loadGlobalConfig(sync) {
  config = (await kv.get(KEY).catch(() => null)) || config;
  try {
    const remote = await sync.pullGlobalConfig();
    if (remote && (remote.updated_at || 0) >= (config.updated_at || 0)) {
      config = remote;
      await kv.set(KEY, config);
    }
  } catch (error) { console.warn('[config] No se pudo descargar configuración', error); }
  return getGlobalConfig();
}
export async function saveGlobalConfig(sync, apiKey) {
  const next = { ...config, v: 1, tmdb: { ...config.tmdb, apiKey: apiKey.trim() }, updated_at: Date.now() };
  await sync.pushGlobalConfig(next);
  config = next;
  await kv.set(KEY, config);
  return getGlobalConfig();
}
