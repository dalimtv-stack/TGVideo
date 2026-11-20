// src/metadata/autoLogo.js
// Logo automático para la ficha (es > en > sin idioma), cacheado en el dispositivo.
// Colecciones/sagas: primero Fanart.tv (si el usuario tiene clave) y, si no hay, TMDB.
import { fetchTmdbImages } from './tmdb.js';
import { fetchFanartImages } from './fanart.js';
import { getFanartKey } from '../settings/global.js';

const mem = new Map();

// v2 para colecciones: invalida logos de TMDB cacheados antes de usar Fanart.tv
const cacheKey = (type, id) =>
  type === 'collection' ? `tgvideo_autologo_v2_${type}_${id}` : `tgvideo_autologo_${type}_${id}`;

async function fanartLogo(type, id) {
  if (!getFanartKey()) return '';
  try {
    const { logo } = await fetchFanartImages(type, id);
    return logo?.[0]?.url || '';
  } catch (_) {
    return '';
  }
}

async function tmdbLogo(type, id) {
  const { logo } = await fetchTmdbImages(type, id);
  return logo?.[0]?.url || '';
}

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
      let url = '';
      if (type === 'collection') url = await fanartLogo(type, id);
      if (!url) url = await tmdbLogo(type, id);
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
