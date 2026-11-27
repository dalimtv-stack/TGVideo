// src/library/channels.js
/**
 * Descubrimiento y listado de canales de vídeo (tgstorage).
 * Categorías soportadas: Series, Películas, Deportes, Música
 */

import { Api } from 'telegram';

const SEP_RE = /\s*::\s*/;
const TSEP = ':';
const TGSTORAGE_SUFFIX_RE = /\s*::\s*tgstorage\s*$/i;
const VALID_CATEGORIES = ['series', 'películas', 'peliculas', 'movies', 'tv', 'deportes', 'sport', 'sports', 'música', 'musica', 'music'];

function normalizeCategory(cat) {
  const c = String(cat || '').toLowerCase().trim();
  if (c === 'peliculas' || c === 'movies') return 'Películas';
  if (c === 'series' || c === 'tv') return 'Series';
  if (['deportes', 'sport', 'sports'].includes(c)) return 'Deportes';
  if (['música', 'musica', 'music'].includes(c)) return 'Música';
  return cat || '';
}

/**
 * Parsea el título de un canal Telegram según la convención tgstorage.
 * Soporta espacios variables, mayúsculas/minúsculas y chats/canales.
 * Ejemplos válidos:
 *   1988:Por año::Películas::tgstorage
 *   Puñales por la espalda:Sagas::Películas::tgstorage
 *   Green Lantern:HBO::Series::tgstorage
 *   HBO::Series::tgstorage
 *   2000-2010::Películas::tgstorage
 *
 * Requiere OBLIGATORIAMENTE una subdivisión previa a la categoría (cadena, año, saga, stream...).
 * Canales desnudos sin subdivisión (ej: "Películas::tgstorage" o "Series::tgstorage") NO son válidos.
 */
export function parseChannelTitle(title) {
  if (!title) return null;
  const rawTitle = String(title).trim();
  if (!TGSTORAGE_SUFFIX_RE.test(rawTitle)) return null;

  const body = rawTitle.replace(TGSTORAGE_SUFFIX_RE, '').trim();
  const parts = body.split(SEP_RE);
  // Requisito indispensable: Debe tener AL MENOS 2 partes antes de ::tgstorage
  // [Subdivisión]::Categoría::tgstorage o [Nombre]:[Subdivisión]::Categoría::tgstorage
  if (parts.length < 2) return null;

  const category = normalizeCategory(parts[parts.length - 1]);
  if (!VALID_CATEGORIES.includes(category.toLowerCase()) &&
      !['Series', 'Películas', 'Deportes', 'Música'].includes(category)) {
    return null;
  }

  const head = parts.slice(0, -1).join('::').trim();
  if (!head || head.toLowerCase() === category.toLowerCase()) {
    return null;
  }

  // Macro o Contenedor directo sin TSEP: Grupo::Categoría::tgstorage (ej. HBO::Series::tgstorage)
  if (!head.includes(TSEP)) {
    const trimmedHead = head.trim();
    const isYear = /^(por a[ñn]o|a[ñn]os|d[ée]cadas|por d[ée]cada)s?$/i.test(trimmedHead) ||
                   /^\d{4}(s|[-–]\d{4})?$/.test(trimmedHead);
    return {
      name: trimmedHead,
      group: trimmedHead,
      category,
      macro: !isYear,
      isYearContainer: category === 'Películas' && isYear,
      isSaga: false,
    };
  }

  // Dedicado o clasificado: Nombre:Grupo::Categoría::tgstorage
  const colonIdx = head.indexOf(TSEP);
  const name = head.slice(0, colonIdx).trim();
  const group = head.slice(colonIdx + 1).trim();
  const trimmedName = name || '';
  const trimmedGroup = group || 'Sin grupo';

  // Contenedores por año (ej: 1988:Por año::Películas::tgstorage)
  const isYearContainer = category === 'Películas' && (
    /^(por a[ñn]o|a[ñn]os|d[ée]cadas|por d[ée]cada)s?$/i.test(trimmedGroup) ||
    /^\d{4}(s|[-–]\d{4})?$/.test(trimmedName)
  );

  // Sagas / Colecciones (ej: Puñales por la espalda:Sagas::Películas::tgstorage)
  const isSaga = category === 'Películas' && (
    /^(sagas?|colecci[oó]n|colecciones|franquicias?)$/i.test(trimmedGroup)
  );

  return {
    name: trimmedName,
    group: trimmedGroup,
    category,
    macro: false,
    isYearContainer,
    isSaga,
  };
}

/**
 * Escanea los diálogos del usuario y devuelve los canales de vídeo de tgstorage.
 * Solo escanea canales/grupos a los que el usuario está unido o propios.
 * Nunca busca globalmente en Telegram para evitar añadir canales ajenos.
 */
export async function loadLibrary(client) {
  const found = new Map();

  const add = (entity, top = 0) => {
    if (!entity) return;
    // Soporte tanto para canales broadcast ('Channel') como grupos privados ('Chat' o supergrupos)
    if (entity.className !== 'Channel' && entity.className !== 'Chat') return;
    // Solo canales a los que el usuario está unido o propios (nunca canales donde no es miembro)
    if (entity.left === true) return;
    const info = parseChannelTitle(entity.title || '');
    if (!info) return;

    found.set(String(entity.id), {
      id: String(entity.id),
      hash: String(entity.accessHash || ''),
      name: info.name,
      group: info.group,
      category: info.category,
      macro: !!info.macro,
      isYearContainer: !!info.isYearContainer,
      isSaga: !!info.isSaga,
      title: entity.title,
      // id del último mensaje: si cambia, el canal se ha modificado
      top: top || found.get(String(entity.id))?.top || 0,
    });
  };

  // Recorrer diálogos activos del usuario
  try {
    for await (const dialog of client.iterDialogs({})) {
      add(dialog.entity, dialog.message?.id || 0);
    }
  } catch (e) {
    console.warn('[library] active dialogs scan failed', e);
  }

  // Recorrer diálogos archivados para no ignorar canales organizados en carpetas archivadas
  try {
    for await (const dialog of client.iterDialogs({ archived: true })) {
      add(dialog.entity, dialog.message?.id || 0);
    }
  } catch (e) {
    console.warn('[library] archived dialogs scan failed', e);
  }

  const list = [...found.values()];

  // Ordenar: primero por categoría, luego por grupo, luego por nombre
  list.sort((a, b) => {
    const c = a.category.localeCompare(b.category);
    if (c !== 0) return c;
    const g = a.group.localeCompare(b.group);
    if (g !== 0) return g;
    return a.name.localeCompare(b.name);
  });

  return list;
}

/**
 * Agrupa la biblioteca por categoría → grupo.
 */
export function groupLibrary(lib) {
  const byCat = new Map();

  for (const ch of lib) {
    const cat = ch.category || 'Otros';
    if (!byCat.has(cat)) byCat.set(cat, new Map());
    const byGroup = byCat.get(cat);
    const group = ch.group || 'Sin grupo';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(ch);
  }

  return byCat;
}


/**
 * Restaura instantáneamente la biblioteca completa desde IndexedDB (library_v2)
 * para que el arranque y la pantalla Home se muestren en 0 ms sin esperar a la red.
 */
export async function restoreLocalLibraryCache(kv, libKey = 'library_v2', { buildTitles, getEpisodeOverride, applyOverridesAndUnbundle, attachAutoCollections, mergeMoviesByTmdb } = {}) {
  try {
    const savedObj = await kv.get(libKey).catch(() => null);
    if (!savedObj) return null;
    if (Array.isArray(savedObj.titles) && savedObj.titles.length > 0) {
      return { titles: savedObj.titles, channels: savedObj.channels || [] };
    }
    if (savedObj.channels && savedObj.cache && typeof buildTitles === 'function') {
      const savedMeta = savedObj.metadataMap || {};
      const savedEpisodeOverrides = savedObj.episodeOverrides || {};
      const { titles } = await buildTitles(null, savedObj.channels, () => null, null, savedObj.cache);
      if (savedMeta) {
        for (const t of titles) {
          if (savedMeta[t.id]) t.metadata = savedMeta[t.id];
          if (t.tipo === 'serie' && Array.isArray(t.archivos)) {
            for (const f of t.archivos) {
              const fKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
              const override = savedEpisodeOverrides[fKey] || getEpisodeOverride?.(fKey) || getEpisodeOverride?.(f);
              if (!override) continue;
              f.season = Number(override.season) || 1;
              f.episodeOverride = override;
              if (override.name) f.metadata = { ...(f.metadata || {}), name: override.name };
            }
          }
          if (Array.isArray(t.archivos) && (t.isSaga || (t.tipo === 'pelicula' && t.archivos.length > 1))) {
            for (const f of t.archivos) {
              const fKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
              if (savedMeta[fKey]) {
                f.metadata = savedMeta[fKey];
                f.tmdbId = savedMeta[fKey].id;
                if (savedMeta[fKey].name && t.isSaga) f.sagaName = savedMeta[fKey].name;
              }
            }
          }
        }
      }
      let processed = applyOverridesAndUnbundle ? applyOverridesAndUnbundle(titles) : titles;
      if (attachAutoCollections && mergeMoviesByTmdb) {
        processed = attachAutoCollections(mergeMoviesByTmdb(processed));
      }
      return { titles: processed, channels: savedObj.channels || [] };
    }
  } catch (err) {
    console.warn('[cache] Error restaurando biblioteca local:', err);
  }
  return null;
}
