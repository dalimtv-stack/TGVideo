// src/metadata/autoLogo.js
// Logo automático de TMDB para la ficha: se elige el mejor (es > en > sin idioma) y se cachea en el dispositivo.
import { fetchTmdbImages } from './tmdb.js';

const mem = new Map();

const cacheKey = (type, id) => `tgvideo_autologo_${type}_${id}`;

export async function getAutoLogo(t) {
  const id = t?.metadata?.id;
  if (!id) return '';
  const type = t.isSaga ? 'collection' : t.tipo === 'serie' ? 'tv' : 'movie';
  const k = cacheKey(type, id);
  if (mem.has(k)) return mem.get(k);
  try {
    const cached = localStorage.getItem(k);
    if (cached !== null) { mem.set(k, cached); return cached; }
  } catch (_) {}
  const job = (async () => {
    try {
      const { logo } = await fetchTmdbImages(type, id);
      const url = logo?.[0]?.url || '';
      try { localStorage.setItem(k, url); } catch (_) {}
      return url;
    } catch (_) {
      mem.delete(k); // error de red: reintentar la próxima vez
      return '';
    }
  })();
  mem.set(k, job);
  const url = await job;
  if (mem.get(k) === job) mem.set(k, url);
  return url;
}
