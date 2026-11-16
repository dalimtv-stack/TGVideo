import { createKV } from '../core/kv.js';
import { getTmdbKey } from '../settings/global.js';
import { getOverride, setOverride, removeOverride } from './overrides.js';
const kv = createKV();
const API = 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p/';

const VALID_YEAR_RE = /(?:19\d{2}|20[0-2]\d|2030)/;

export function extractTitleAndYear(name = '') {
  let str = String(name || '').trim();
  try { str = decodeURIComponent(str); } catch (_) {}
  str = str.replace(/\.(mkv|mp4|avi|mov|m4v|webm|ts)$/i, '')
    .replace(/\b(2160p|1080p|720p|480p|bluray|brrip|webrip|web[- ]?dl|hdtv|x26[45]|h26[45]|hevc)\b.*/i, '')
    .replace(/[ST]\d{1,2}[\s._-]*E\d{1,3}.*/i, '')
    .replace(/\d{1,2}x\d{1,3}.*/i, '')
    .replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();

  let year = null;
  const parenMatch = str.match(/[\(\[]\s*((?:19\d{2}|20[0-2]\d|2030))\s*[\)\]]/);
  if (parenMatch) {
    const stripped = str.replace(/[\(\[]\s*(?:19\d{2}|20[0-2]\d|2030)\s*[\)\]]/g, '').trim();
    if (stripped) {
      year = parenMatch[1];
      str = stripped;
    }
  } else {
    const endYearMatch = str.match(/(?:^|[\s_-])\b((?:19\d{2}|20[0-2]\d|2030))\s*$/);
    if (endYearMatch) {
      const stripped = str.slice(0, endYearMatch.index).trim();
      if (stripped) {
        year = endYearMatch[1];
        str = stripped;
      }
    }
  }

  str = str.replace(/[-–—\s]+$/, '').trim();
  return { title: str || String(name || '').trim(), year };
}

export function cleanSearchName(name = '') {
  return extractTitleAndYear(name).title;
}

export function parseTmdbId(value) {
  const m = String(value || '').match(/(?:themoviedb\.org\/(?:tv|movie|collection)\/|^(?:(?:tv|movie|collection)[:/])?)(\d+)/i);
  return m ? Number(m[1]) : null;
}
export function imageUrl(path, size = 'w342') { return path?.startsWith('/') ? IMAGE + size + path : ''; }
async function request(path, params = {}, signal) {
  const key = getTmdbKey();
  if (!key) throw new Error('Introduce tu clave de TMDB en Ajustes globales.');
  const url = new URL(API + path);
  url.searchParams.set('language', 'es-ES');
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const headers = {};
  if (key.includes('.')) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);
  const response = await fetch(url, { headers, signal });
  if (!response.ok) throw new Error(response.status === 401 ? 'La clave de TMDB no es válida.' : `TMDB no disponible (${response.status}).`);
  return response.json();
}
export async function validateTmdbKey() { return request('/configuration'); }

const normalize = s => String(s || '')
  .replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

export async function setManualMetadata(title, metadata) {
  if (!title || !metadata) return null;
  const key = `manual_tmdb:${title.id}`;
  await kv.set(key, metadata).catch(e => console.warn('[tmdb] Error guardando identificación manual', e));
  // Sincronizar con otros dispositivos (sirve también para mensajes reenviados)
  await setOverride(title.id, metadata).catch(e => console.warn('[tmdb] Error guardando override', e));
  title.metadata = metadata;
  title.tmdbId = metadata.id;
  return metadata;
}

export async function clearManualMetadata(title) {
  if (!title) return;
  const key = `manual_tmdb:${title.id}`;
  await kv.del(key).catch(() => {});
  await removeOverride(title.id).catch(() => {});
  title.metadata = null;
  title.tmdbId = null;
}

export async function fetchTmdbFullDetails(type, id, signal) {
  const endpoint = type === 'collection' ? 'collection' : (type === 'serie' || type === 'tv' ? 'tv' : 'movie');
  if (endpoint === 'collection') return {};
  const append = endpoint === 'tv' ? 'credits,external_ids,content_ratings' : 'credits,external_ids,release_dates';
  try {
    const data = await request(`/${endpoint}/${id}`, { append_to_response: append }, signal);
    const crew = data.credits?.crew || [];
    const director = crew.find(c => c.job === 'Director')?.name || '';
    const writer = crew.find(c => c.job === 'Screenplay' || c.job === 'Writer' || c.job === 'Story')?.name || '';
    const cast = (data.credits?.cast || []).slice(0, 5).map(c => c.name).join(', ');
    const imdbId = data.external_ids?.imdb_id || data.imdb_id || '';
    let ageRating = '';
    if (endpoint === 'movie') {
      const esRelease = data.release_dates?.results?.find(r => r.iso_3166_1 === 'ES');
      const cert = esRelease?.release_dates?.find(d => d.certification)?.certification;
      if (cert) ageRating = cert;
    } else {
      const esRating = data.content_ratings?.results?.find(r => r.iso_3166_1 === 'ES');
      if (esRating?.rating) ageRating = esRating.rating;
    }
    return {
      director,
      writer,
      cast,
      imdbId,
      ageRating,
      rating: data.vote_average != null ? Number(data.vote_average) : 0,
      overview: data.overview || '',
    };

  } catch (e) {
    console.warn('[tmdb] Error fetching full details:', e);
    return {};
  }
}

export async function searchTmdbManual({ query, type = 'movie', year = '', directId = null }, signal) {
  const endpoint = type === 'collection' ? 'collection' : type === 'serie' || type === 'tv' ? 'tv' : 'movie';
  const id = parseTmdbId(directId);
  if (id) {
    const data = await request(`/${endpoint}/${id}`, {}, signal);
    return [{
      id: data.id,
      type: endpoint,
      name: data.name || data.title,
      overview: data.overview || '',
      date: data.first_air_date || data.release_date || '',
      poster: imageUrl(data.poster_path),
      backdrop: imageUrl(data.backdrop_path, 'w1280'),
      rating: data.vote_average || 0,
    }];
  }

  const parsed = extractTitleAndYear(query);
  const q = String(parsed.title || query || '').trim();
  const searchYear = String(year || parsed.year || '').trim();

  if (!q) return [];
  const params = { query: q };
  if (searchYear && endpoint !== 'collection') {
    params[endpoint === 'tv' ? 'first_air_date_year' : 'year'] = searchYear;
  }
  let search = await request(`/search/${endpoint}`, params, signal);
  if ((!search.results || search.results.length === 0) && searchYear && endpoint !== 'collection') {
    search = await request(`/search/${endpoint}`, { query: q }, signal).catch(() => search);
  }

  // Fallback si contiene caracteres especiales o "ñ": probar búsqueda transliterada
  if (!search.results || search.results.length === 0) {
    const unaccented = q
      .replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (unaccented && unaccented.toLowerCase() !== q.toLowerCase()) {
      search = await request(`/search/${endpoint}`, { query: unaccented }, signal).catch(() => search);
    }
  }

  return (search.results || []).slice(0, 10).map(r => ({
    id: r.id,
    type: endpoint,
    name: r.name || r.title,
    overview: r.overview || '',
    date: r.first_air_date || r.release_date || '',
    poster: imageUrl(r.poster_path),
    backdrop: imageUrl(r.backdrop_path, 'w1280'),
    rating: r.vote_average || 0,
  }));
}

async function enrichSaga(title, { signal } = {}) {
  const ov = getOverride(title.id);
  if (ov) { title.metadata = ov; title.tmdbId = ov.id; return ov; }
  const manual = await kv.get(`manual_tmdb:${title.id}`).catch(() => null);
  if (manual) { title.metadata = manual; title.tmdbId = manual.id; return manual; }

  const directId = parseTmdbId(title.tmdbId || title.archivos.find(f => f.tmdbId)?.tmdbId);
  const query = cleanSearchName(title.nombre);
  const cacheKey = `tmdb_v2:collection:${directId || query.toLowerCase()}`;
  const cached = await kv.get(cacheKey).catch(() => null);
  if (cached) { title.metadata = cached; return cached; }
  if (!getTmdbKey()) return null;
  let data;
  if (directId) data = await request(`/collection/${directId}`, {}, signal);
  else {
    let search = await request('/search/collection', { query }, signal);
    if (!search.results || search.results.length === 0) {
      const unaccented = query.replace(/ñ/g, 'n').replace(/Ñ/g, 'N').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      if (unaccented && unaccented.toLowerCase() !== query.toLowerCase()) {
        search = await request('/search/collection', { query: unaccented }, signal).catch(() => search);
      }
    }
    const match = search.results?.find(r => normalize(r.name) === normalize(query)) || search.results?.[0];
    if (!match?.id) return null;
    data = await request(`/collection/${match.id}`, {}, signal);
  }
  const metadata = {
    id: data.id, type: 'collection', name: data.name || title.nombre,
    overview: data.overview || '', poster: imageUrl(data.poster_path),
    backdrop: imageUrl(data.backdrop_path, 'w1280'),
  };
  await kv.set(cacheKey, metadata).catch(error => console.warn('[tmdb] Caché no disponible', error));
  title.metadata = metadata;
  return metadata;
}

export async function enrichTitle(title, { signal } = {}) {
  const ov = getOverride(title.id);
  if (ov) { title.metadata = ov; title.tmdbId = ov.id; return ov; }
  const manual = await kv.get(`manual_tmdb:${title.id}`).catch(() => null);
  if (manual) { title.metadata = manual; title.tmdbId = manual.id; return manual; }

  if (title.isSaga) return enrichSaga(title, { signal });
  const type = title.tipo === 'serie' ? 'tv' : 'movie';
  const directId = parseTmdbId(title.tmdbId || title.archivos.find(f => f.tmdbId)?.tmdbId);
  const parsed = extractTitleAndYear(title.nombre);
  const query = parsed.title;
  const year = title.yearHint || parsed.year;
  const cacheKey = `tmdb_v2:${type}:${directId || `${query.toLowerCase()}:${year || ''}`}`;
  const cached = await kv.get(cacheKey).catch(() => null);
  if (cached) { title.metadata = cached; return cached; }
  if (!getTmdbKey()) return null;
  let id = directId;
  if (!id) {
    const params = { query };
    if (year) {
      params[type === 'tv' ? 'first_air_date_year' : 'year'] = year;
    }
    let search = await request(`/search/${type}`, params, signal);
    if ((!search.results || search.results.length === 0) && year) {
      search = await request(`/search/${type}`, { query }, signal).catch(() => search);
    }
    // Fallback para caracteres con "ñ" o tildes que puedan no coincidir exactamente en TMDB
    if (!search.results || search.results.length === 0) {
      const unaccented = query.replace(/ñ/g, 'n').replace(/Ñ/g, 'N').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      if (unaccented && unaccented.toLowerCase() !== query.toLowerCase()) {
        search = await request(`/search/${type}`, { query: unaccented }, signal).catch(() => search);
      }
    }
    const match = search.results?.find(r => [r.name, r.title, r.original_name, r.original_title].some(n => n && normalize(n) === normalize(query)))
      || search.results?.find(r => [r.name, r.title, r.original_name, r.original_title].some(n => n && (normalize(n).includes(normalize(query)) || normalize(query).includes(normalize(n)))))
      || search.results?.[0];
    id = match?.id;
  }
  if (!id) return null;
  const data = await request(`/${type}/${id}`, {}, signal);
  const metadata = { id: data.id, type, name: data.name || data.title, overview: data.overview, rating: data.vote_average,
    date: data.first_air_date || data.release_date, poster: imageUrl(data.poster_path), backdrop: imageUrl(data.backdrop_path, 'w1280') };
  await kv.set(cacheKey, metadata).catch(error => console.warn('[tmdb] Caché no disponible', error));
  title.metadata = metadata;
  return metadata;
}

export async function enrichTitles(titles, { signal, onUpdate } = {}) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(3, titles.length) }, async () => {
    while (index < titles.length && !signal?.aborted) {
      const title = titles[index++];
      try {
        if (await enrichTitle(title, { signal })) onUpdate?.(title);
        // Cada película dentro de una saga obtiene metadatos propios, además de la portada de colección.
        if (title.isSaga) {
          for (const file of title.archivos) {
            if (signal?.aborted) break;
            const parsedFilm = extractTitleAndYear(file.fileName || file.label);
            const film = {
              tipo: 'pelicula', nombre: parsedFilm.title, tmdbId: file.tmdbId,
              yearHint: file.fileName?.match(/\b((?:19\d{2}|20[0-2]\d|2030))\b/)?.[1] || parsedFilm.year, archivos: [file],
            };
            try {
              const metadata = await enrichTitle(film, { signal });
              if (metadata) { file.metadata = metadata; onUpdate?.(title); }
            } catch (error) {
              if (error.name !== 'AbortError') console.warn('[tmdb saga film]', error.message);
            }
          }
        }
      } catch (error) { if (error.name !== 'AbortError') console.warn('[tmdb]', error.message); }
    }
  }));
}

const seasonCache = new Map();

export async function fetchSeasonEpisodes(tvId, seasonNumber = 1, signal) {
  if (!tvId) return [];
  const key = `${tvId}_s${seasonNumber}`;
  if (seasonCache.has(key)) return seasonCache.get(key);
  try {
    const data = await request(`/tv/${tvId}/season/${seasonNumber}`, {}, signal);
    const list = data.episodes || [];
    seasonCache.set(key, list);
    return list;
  } catch (e) {
    return [];
  }
}
