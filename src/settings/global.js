import { createKV } from '../core/kv.js';

const kv = createKV();
const KEY = 'config_global_v1';
let config = { v: 1, tmdb: { apiKey: '' }, fanart: { apiKey: '' }, cache: { maxMb: 100 }, updated_at: 0 };

export function getGlobalConfig() { return structuredClone(config); }
export function getTmdbKey() {
  return config.tmdb?.apiKey || import.meta.env?.VITE_TMDB_DEMO_API_KEY || '';
}
export function getFanartKey() {
  return config.fanart?.apiKey || import.meta.env?.VITE_FANART_API_KEY || '';
}
export function getCacheMaxMb() {
  return Number(config.cache?.maxMb) || 100;
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
export async function saveGlobalConfig(sync, options = {}) {
  const apiKey = typeof options === 'string' ? options : options.apiKey;
  const fanartApiKey = options.fanartApiKey !== undefined ? options.fanartApiKey : (config.fanart?.apiKey || '');
  const cacheMaxMb = options.cacheMaxMb !== undefined ? Number(options.cacheMaxMb) : (config.cache?.maxMb || 100);

  const next = {
    ...config,
    v: 1,
    tmdb: { ...config.tmdb, apiKey: typeof apiKey === 'string' ? apiKey.trim() : (config.tmdb?.apiKey || '') },
    fanart: { ...config.fanart, apiKey: typeof fanartApiKey === 'string' ? fanartApiKey.trim() : (config.fanart?.apiKey || '') },
    cache: { ...config.cache, maxMb: Math.max(10, Math.min(5000, cacheMaxMb || 100)) },
    updated_at: Date.now()
  };
  await sync.pushGlobalConfig(next);
  config = next;
  await kv.set(KEY, config);
  return getGlobalConfig();
}
