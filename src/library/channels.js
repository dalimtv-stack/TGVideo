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
 * Ejemplos:
 *   1988:Por año::Películas::tgstorage
 *   Puñales por la espalda:Sagas::Películas::tgstorage
 *   Green Lantern:HBO::Series::tgstorage
 *   HBO::Series::tgstorage
 *   2000-2010::Películas::tgstorage
 */
export function parseChannelTitle(title) {
  if (!title) return null;
  const rawTitle = String(title).trim();
  if (!TGSTORAGE_SUFFIX_RE.test(rawTitle)) return null;

  const body = rawTitle.replace(TGSTORAGE_SUFFIX_RE, '').trim();
  const parts = body.split(SEP_RE);
  if (parts.length === 0) return null;

  let category = '';
  let head = '';
  if (parts.length === 1) {
    category = normalizeCategory(parts[0]);
    head = category;
  } else {
    category = normalizeCategory(parts[parts.length - 1]);
    head = parts.slice(0, -1).join('::');
  }

  if (!VALID_CATEGORIES.includes(category.toLowerCase()) &&
      !['Series', 'Películas', 'Deportes', 'Música'].includes(category)) {
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
 * Escanea los diálogos del usuario y devuelve los canales de vídeo.
 */
export async function loadLibrary(client) {
  const found = new Map();

  const add = (entity, top = 0) => {
    if (!entity) return;
    // Soporte tanto para canales broadcast ('Channel') como grupos privados ('Chat' o supergrupos)
    if (entity.className !== 'Channel' && entity.className !== 'Chat') return;
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

  // Búsqueda por el sufijo
  try {
    const res = await client.invoke(
      new Api.contacts.Search({ q: 'tgstorage', limit: 100 })
    );
    (res.chats || []).forEach(add);
  } catch (e) {
    console.warn('[library] search failed', e);
  }

  // Recorrer diálogos activos
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
