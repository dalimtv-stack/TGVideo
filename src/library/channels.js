/**
 * Descubrimiento y listado de canales de vídeo (tgstorage).
 * Categorías soportadas: Series, Películas
 */

import { Api } from 'telegram';

const SEP = '::';
const TSEP = ':';
const POST = '::tgstorage';
const VALID_CATEGORIES = ['series', 'películas', 'peliculas', 'movies', 'tv'];

function normalizeCategory(cat) {
  const c = String(cat || '').toLowerCase().trim();
  if (c === 'peliculas' || c === 'movies') return 'Películas';
  if (c === 'series' || c === 'tv') return 'Series';
  return cat || '';
}

/**
 * Parsea el título de un canal Telegram según la convención tgstorage.
 * Ejemplos:
 *   1988:Por año::Películas::tgstorage
 *   Puñales por la espalda:Sagas::Películas::tgstorage
 *   Green Lantern:HBO::Series::tgstorage
 *   HBO::Series::tgstorage
 *   2000-2010::Películas::tgstorage
 */
export function parseChannelTitle(title) {
  if (!title || !String(title).endsWith(POST)) return null;

  const body = title.slice(0, -POST.length); // quita ::tgstorage
  const parts = body.split(SEP);
  if (parts.length < 2) return null;

  const category = normalizeCategory(parts[parts.length - 1]);
  if (!VALID_CATEGORIES.includes(category.toLowerCase()) &&
      !['Series', 'Películas'].includes(category)) {
    return null;
  }

  const head = parts.slice(0, -1).join(SEP);

  // Macro o Contenedor directo sin TSEP: Grupo::Categoría::tgstorage
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
  const [name, group = ''] = head.split(TSEP);
  const trimmedName = (name || '').trim();
  const trimmedGroup = (group || 'Sin grupo').trim();

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
    if (!entity || entity.className !== 'Channel') return;
    const info = parseChannelTitle(entity.title || '');
    if (!info) return;

    found.set(String(entity.id), {
      id: String(entity.id),
      hash: String(entity.accessHash),
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

  // Recorrer diálogos
  for await (const dialog of client.iterDialogs({})) {
    add(dialog.entity, dialog.message?.id || 0);
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
