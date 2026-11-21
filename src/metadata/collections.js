// src/metadata/collections.js
// Gestión manual de colecciones: listar las existentes y añadir / quitar una película de una colección.
//
// La pertenencia se guarda en el metadato de la película (metadata.collection) a través de la
// identificación manual (overrides), que ya se sincroniza entre dispositivos. Así la película pasa a
// formar parte de la colección en todos los dispositivos y perfiles.
import { setManualMetadata } from './tmdb.js';

const normalize = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Colección a la que pertenece actualmente una película (o null). */
export function getMovieCollection(title) {
  const c = title?.metadata?.collection;
  return c && c.id ? c : null;
}

/**
 * Colecciones disponibles en la biblioteca (sagas físicas por canal y colecciones automáticas).
 * @returns {Array<{ id: string|number, name: string, poster: string|null, backdrop: string|null, count: number }>}
 */
export function listLibraryCollections(titles = []) {
  const map = new Map();
  for (const t of titles) {
    if (!t.isSaga && !t.isVirtualSaga) continue;
    const id = t.metadata?.id || t.tmdbId;
    if (!id) continue; // sin identificar en TMDB no se puede enlazar
    const key = String(id);
    if (map.has(key)) continue;
    map.set(key, {
      id,
      name: t.metadata?.name || t.nombre || `Colección ${id}`,
      poster: t.metadata?.poster || null,
      backdrop: t.metadata?.backdrop || null,
      count: (t.archivos || []).length,
    });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

export function filterCollections(list, query) {
  const q = normalize(query);
  if (!q) return list;
  return list.filter((c) => normalize(c.name).includes(q));
}

async function applyCollection(title, collection) {
  if (!title?.metadata) throw new Error('La película no está identificada en TMDB.');
  const meta = { ...title.metadata, collection };
  await setManualMetadata(title, meta);               // guarda localmente y en overrides sincronizados
  for (const f of (title.archivos || [])) { f.metadata = meta; f.tmdbId = meta.id; }
  return meta;
}

/** Añade la película a una colección existente (la fija como manual y la sincroniza). */
export function assignMovieToCollection(title, col) {
  return applyCollection(title, {
    id: col.id,
    name: col.name,
    poster: col.poster || null,
    backdrop: col.backdrop || null,
    manual: true,
  });
}

/** Saca la película de su colección (aunque TMDB la incluya en una). */
export function removeMovieFromCollection(title) {
  return applyCollection(title, null);
}
