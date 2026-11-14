import { createKV } from '../core/kv.js';
import { getTmdbKey } from '../settings/global.js';
const kv = createKV();
const API = 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p/';

export function cleanSearchName(name = '') {
  return String(name).replace(/\.(mkv|mp4|avi|mov|m4v|webm|ts)$/i, '')
    .replace(/[ST]\d{1,2}[\s._-]*E\d{1,3}.*/i, '')
    .replace(/\d{1,2}x\d{1,3}.*/i, '')
    .replace(/\b(2160p|1080p|720p|480p|bluray|brrip|webrip|web[- ]?dl|hdtv|x26[45]|h26[45]|hevc)\b.*/i, '')
    .replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function parseTmdbId(value) {
  const m = String(value || '').match(/(?:themoviedb\.org\/(?:tv|movie)\/|^(?:(?:tv|movie)[:/])?)(\d+)/i);
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
export async function enrichTitle(title, { signal } = {}) {
  const type = title.tipo === 'serie' ? 'tv' : 'movie';
  const directId = parseTmdbId(title.tmdbId || title.archivos.find(f => f.tmdbId)?.tmdbId);
  const query = cleanSearchName(title.nombre);
  const cacheKey = `tmdb_v1:${type}:${directId || query.toLowerCase()}`;
  const cached = await kv.get(cacheKey).catch(() => null);
  if (cached) { title.metadata = cached; return cached; }
  if (!getTmdbKey()) return null;
  let id = directId;
  if (!id) {
    const year = query.match(/\b((?:19|20)\d{2})\b/)?.[1];
    const search = await request(`/search/${type}`, { query: query.replace(/\(?\b(?:19|20)\d{2}\b\)?/, '').trim(), ...(year ? { [type === 'tv' ? 'first_air_date_year' : 'year']: year } : {}) }, signal);
    const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const match = search.results?.find(r => [r.name, r.title, r.original_name, r.original_title].some(n => n && normalize(n) === normalize(query))) || search.results?.[0];
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
      try { if (await enrichTitle(title, { signal })) onUpdate?.(title); }
      catch (error) { if (error.name !== 'AbortError') console.warn('[tmdb]', error.message); }
    }
  }));
}
