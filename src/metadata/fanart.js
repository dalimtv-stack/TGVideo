// src/metadata/fanart.js
// Integración con la API v3 de Fanart.tv para carátulas, fondos y logos de alta calidad.
import { getFanartKey } from '../settings/global.js';
import { fetchTvExternalIds } from './tmdb.js';

const API = 'https://webservice.fanart.tv/v3';

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

/**
 * Obtiene imágenes disponibles en Fanart.tv para un título (película, colección o serie).
 * @param {'movie'|'serie'|'tv'|'collection'} type
 * @param {number|string} tmdbId
 * @param {object} [options]
 * @returns {Promise<{ poster: Array, backdrop: Array, logo: Array }>}
 */
export async function fetchFanartImages(type, tmdbId, options = {}) {
  const key = getFanartKey();
  if (!key) {
    throw new Error('Introduce tu clave de Fanart.tv en Ajustes globales para ver imágenes de Fanart.tv.');
  }

  if (!tmdbId) {
    return { poster: [], backdrop: [], logo: [] };
  }

  const isTv = (type === 'serie' || type === 'tv');
  const endpoint = isTv ? 'tv' : 'movies';
  let targetId = String(tmdbId);

  // La API de TV de Fanart.tv utiliza el ID de TVDB (TheTVDB).
  // Si no se suministra en externalIds, intentamos resolverlo mediante la API de TMDB.
  if (isTv) {
    let tvdbId = options.externalIds?.tvdb_id || options.tvdbId;
    if (!tvdbId) {
      const ext = await fetchTvExternalIds(tmdbId, options.signal);
      if (ext?.tvdb_id) tvdbId = ext.tvdb_id;
    }
    if (tvdbId) {
      targetId = String(tvdbId);
    }
  }

  const url = `${API}/${endpoint}/${encodeURIComponent(targetId)}?api_key=${encodeURIComponent(key)}`;
  const response = await fetch(url, { signal: options.signal });

  if (response.status === 401) {
    throw new Error('La clave de Fanart.tv no es válida o ha caducado.');
  }
  if (response.status === 404) {
    return { poster: [], backdrop: [], logo: [] };
  }
  if (!response.ok) {
    throw new Error(`Fanart.tv no disponible (${response.status}).`);
  }

  const data = await response.json();

  const mapList = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map(im => {
        const fullUrl = im.url || '';
        // Fanart.tv ofrece miniaturas rápidas sustituyendo '/fanart/' por '/preview/'
        const thumbUrl = fullUrl.includes('/fanart/') ? fullUrl.replace('/fanart/', '/preview/') : fullUrl;
        return {
          thumb: thumbUrl,
          url: fullUrl,
          lang: im.lang || '',
          likes: Number(im.likes) || 0
        };
      })
      .sort((a, b) => {
        const aEs = a.lang === 'es' ? 2 : (a.lang === 'en' || !a.lang ? 1 : 0);
        const bEs = b.lang === 'es' ? 2 : (b.lang === 'en' || !b.lang ? 1 : 0);
        if (bEs !== aEs) return bEs - aEs;
        return b.likes - a.likes;
      });
  };

  if (!isTv) {
    return {
      poster: mapList(data.movieposter),
      backdrop: mapList(data.moviebackground),
      logo: mapList([...(data.hdmovielogo || []), ...(data.movielogo || [])]),
    };
  } else {
    return {
      poster: mapList([...(data.tvposter || []), ...(data.seasonposter || [])]),
      backdrop: mapList(data.showbackground),
      logo: mapList([...(data.hdtvlogo || []), ...(data.clearlogo || [])]),
    };
  }
}
