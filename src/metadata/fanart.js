// src/metadata/fanart.js
// Integración con la API v3 de Fanart.tv para carátulas, fondos y logos de alta calidad.
//
// - Películas: /movies/{tmdbId}
// - Series:    /tv/{tvdbId}  (se resuelve desde TMDB si hace falta)
// - Colecciones (sagas): Fanart.tv no indexa las colecciones de TMDB; se consultan las películas
//   que forman la colección (obtenidas de TMDB) y se combinan sus imágenes.
import { getFanartKey } from '../settings/global.js';
import { fetchTvExternalIds, fetchTmdbCollectionParts } from './tmdb.js';

const API = 'https://webservice.fanart.tv/v3';
const EMPTY = () => ({ poster: [], backdrop: [], logo: [] });
const COLLECTION_PARTS_LIMIT = 8;

/**
 * Valida una clave de Fanart.tv con una petición de prueba ligera.
 * @param {string} apiKey
 * @returns {Promise<boolean>}
 */
export async function validateFanartKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return false;
  const key = apiKey.trim();
  const testUrl = `${API}/movies/550?api_key=${encodeURIComponent(key)}`;
  const resp = await fetch(testUrl);
  if (resp.status === 401) {
    throw new Error('La clave de Fanart.tv no es válida.');
  }
  return resp.ok;
}

/** Extrae el ID de TMDB de una URL de Fanart.tv (https://fanart.tv/movie/603/) o devuelve null. */
export function parseFanartMovieId(value) {
  const m = String(value || '').match(/fanart\.tv\/movie\/(\d+)/i);
  return m ? Number(m[1]) : null;
}

const langRank = (l) => (l === 'es' ? 2 : (l === 'en' || !l ? 1 : 0));

function mapList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((im) => {
    const fullUrl = im.url || '';
    // Fanart.tv ofrece miniaturas rápidas sustituyendo '/fanart/' por '/preview/'
    const thumbUrl = fullUrl.includes('/fanart/') ? fullUrl.replace('/fanart/', '/preview/') : fullUrl;
    return { thumb: thumbUrl, url: fullUrl, lang: im.lang || '', likes: Number(im.likes) || 0 };
  });
}

function sortImages(list) {
  const seen = new Set();
  return list
    .filter((im) => im.url && !seen.has(im.url) && seen.add(im.url))
    .sort((a, b) => (langRank(b.lang) - langRank(a.lang)) || (b.likes - a.likes));
}

async function request(path, signal) {
  const key = getFanartKey();
  const response = await fetch(`${API}${path}?api_key=${encodeURIComponent(key)}`, { signal });
  if (response.status === 401) throw new Error('La clave de Fanart.tv no es válida o ha caducado.');
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Fanart.tv no disponible (${response.status}).`);
  return response.json();
}

function movieImages(data) {
  if (!data) return EMPTY();
  return {
    poster: mapList(data.movieposter),
    backdrop: mapList(data.moviebackground),
    logo: mapList([...(data.hdmovielogo || []), ...(data.movielogo || [])]),
  };
}

async function fetchCollectionImages(collectionId, options) {
  const parts = (await fetchTmdbCollectionParts(collectionId, options.signal)).slice(0, COLLECTION_PARTS_LIMIT);
  if (!parts.length) return EMPTY();
  const results = await Promise.allSettled(parts.map((p) => request(`/movies/${encodeURIComponent(p.id)}`, options.signal)));
  // Si TODAS fallan (p. ej. clave inválida), propagar el error para mostrarlo
  if (results.every((r) => r.status === 'rejected')) throw results[0].reason;
  const merged = EMPTY();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const imgs = movieImages(r.value);
    merged.poster.push(...imgs.poster);
    merged.backdrop.push(...imgs.backdrop);
    merged.logo.push(...imgs.logo);
  }
  return { poster: sortImages(merged.poster), backdrop: sortImages(merged.backdrop), logo: sortImages(merged.logo) };
}

/**
 * Obtiene imágenes disponibles en Fanart.tv para un título (película, colección o serie).
 * @param {'movie'|'serie'|'tv'|'collection'} type
 * @param {number|string} tmdbId
 * @param {object} [options]  { externalIds, tvdbId, signal }
 * @returns {Promise<{ poster: Array, backdrop: Array, logo: Array }>}
 */
export async function fetchFanartImages(type, tmdbId, options = {}) {
  if (!getFanartKey()) {
    throw new Error('Introduce tu clave de Fanart.tv en Ajustes globales para ver imágenes de Fanart.tv.');
  }
  if (!tmdbId) return EMPTY();

  if (type === 'collection') return fetchCollectionImages(tmdbId, options);

  const isTv = (type === 'serie' || type === 'tv');
  let targetId = String(tmdbId);

  // La API de TV de Fanart.tv utiliza el ID de TVDB (TheTVDB).
  if (isTv) {
    let tvdbId = options.externalIds?.tvdb_id || options.tvdbId;
    if (!tvdbId) {
      const ext = await fetchTvExternalIds(tmdbId, options.signal);
      if (ext?.tvdb_id) tvdbId = ext.tvdb_id;
    }
    if (!tvdbId) return EMPTY();
    targetId = String(tvdbId);
  }

  const data = await request(`/${isTv ? 'tv' : 'movies'}/${encodeURIComponent(targetId)}`, options.signal);
  if (!data) return EMPTY();

  if (!isTv) {
    const m = movieImages(data);
    return { poster: sortImages(m.poster), backdrop: sortImages(m.backdrop), logo: sortImages(m.logo) };
  }
  return {
    poster: sortImages(mapList([...(data.tvposter || []), ...(data.seasonposter || [])])),
    backdrop: sortImages(mapList(data.showbackground)),
    logo: sortImages(mapList([...(data.hdtvlogo || []), ...(data.clearlogo || [])])),
  };
}

/** Mejor imagen de cada tipo (es > en > sin idioma, y más votada). null si no hay. */
export async function fetchFanartBest(type, tmdbId, options = {}) {
  const imgs = await fetchFanartImages(type, tmdbId, options);
  return {
    poster: imgs.poster[0]?.url || null,
    backdrop: imgs.backdrop[0]?.url || null,
    logo: imgs.logo[0]?.url || null,
  };
}
