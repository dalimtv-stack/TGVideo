// src/library/titles.js
/**
 * Capa de datos: convierte canales (dedicados, contenedores de año y macro) en "Títulos" unificados.
 * No toca el DOM.
 */
import { isVideoMessage, getFileName, parseCaption, parseEpisode, prettyName } from './parse.js';
import { splitBySection } from './macro.js';
import { parseChannelTitle } from './channels.js';
import { extractTitleAndYear } from '../metadata/tmdb.js';

async function scanFiles(client, peer, ch) {
  const files = [];
  for await (const msg of client.iterMessages(peer)) {
    if (!isVideoMessage(msg)) continue;
    const rawCaption = msg.message || '';
    const cap = parseCaption(rawCaption);
    // Telegram habitualmente trunca los nombres largos en DocumentAttributeFilename.
    // Si el caption incluye "Nombre de archivo: ", se respeta escrupulosamente.
    const captionFileName = cap.fileName ? cap.fileName.trim() : null;
    const rawFileName = getFileName(msg) || '';
    const fileName = captionFileName || rawFileName || `video_${msg.id}`;
    const ep = parseEpisode(fileName);
    const doc = msg.document || msg.media?.document;
    const durAttr = doc?.attributes?.find(a => a.className === 'DocumentAttributeVideo');
    files.push({
      key: `${ch.id}:${msg.id}`, channelId: String(ch.id), messageId: msg.id,
      channel: ch,
      fileName,
      captionFileName,
      rawFileName,
      rawCaption,
      label: prettyName(fileName), section: cap.section || null,
      synopsis: cap.synopsis || null, tmdbId: cap.tmdbId ? String(cap.tmdbId).trim() : null,
      season: ep.season, episode: ep.episode,
      size: Number(doc?.size?.toString?.() || doc?.size || 0),
      duration: durAttr?.duration || 0, mimeType: doc?.mimeType || 'video/mp4', date: msg.date,
    });
  }
  return files;
}

function sortFiles(files, tipo) {
  if (tipo === 'pelicula') {
    return files.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0) || (b.date || 0) - (a.date || 0));
  }
  return files.sort((a, b) => (a.season - b.season) || (a.episode - b.episode) || (a.date - b.date));
}

function makeTitle({ id, ch, name, origen, seccion, files }) {
  const tipo = ch.category === 'Películas' ? 'pelicula' : ch.category === 'Series' ? 'serie' : ch.category === 'Deportes' ? 'deporte' : ch.category === 'Música' ? 'musica' : 'serie';
  sortFiles(files, tipo);
  return {
    id: String(id), tipo, grupo: ch.group, nombre: name,
    origen: { tipo: origen, channelId: String(ch.id), seccion: seccion || null },
    channel: ch, archivos: files,
    ultimoMensajeFecha: files.reduce((m, f) => Math.max(m, f.date), 0),
    tmdbId: files.find(f => f.tmdbId)?.tmdbId || null,
  };
}

const YEAR_RE = /\b((?:19|20)\d{2})\b/;
const YEAR_GROUP_RE = /^(?:por\s+año|por\s+ano|años|anos|décadas|decadas|por\s+década|por\s+decada)$/i;

// Nombre de la serie a partir del archivo: texto anterior a S01E02 / 1x02 / T1E02
export function seriesNameFromFile(fileName = '') {
  const base = String(fileName).replace(/\.(mkv|mp4|avi|mov|m4v|webm|ts)$/i, '').replace(/[._]+/g, ' ');
  const m = base.match(/^(.*?)[\s\-–—\[(]*(?:[ST]\d{1,2}\s*E\d{1,3}|\d{1,2}x\d{1,3}|temp(?:orada)?\s*\d)/i);
  const name = (m ? m[1] : base).replace(/[\s\-–—:]+$/, '').replace(/\s+/g, ' ').trim();
  return name || '(Sin sección)';
}

function movieName(file) {
  const target = file.captionFileName || file.fileName || file.label || `video_${file.messageId}`;
  const parsed = extractTitleAndYear(target);
  if (parsed.title) return parsed.title;
  return String(target)
    .replace(/\.(mkv|mp4|avi|mov|m4v|webm|ts)$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\b(\d{3,4}p|[248]k|bluray|brrip|webrip|web[- ]?dl|hdtv|x26[45]|h26[45]|hevc)\b.*/i, '')
    .replace(/\s+/g, ' ').trim();
}

function normalizeMovieKey(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(castellano|latino|spa|esp|eng|dual|multi|subs?|vose|uhd|remux|hdr|dts|ac3|aac|x264|x265)\b/gi, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Agrupa películas con el mismo ID de TMDB en una sola ficha de biblioteca,
 * consolidando todas sus versiones de vídeo en el array `archivos`.
 */
export function mergeMoviesByTmdb(titles) {
  if (!Array.isArray(titles)) return [];
  const result = [];
  const movieTmdbMap = new Map(); // tmdbId -> index in result

  for (const t of titles) {
    if (t.tipo !== 'pelicula' || t.isSaga) {
      result.push(t);
      continue;
    }

    const rawTmdbId = t.metadata?.id || t.tmdbId;
    if (!rawTmdbId) {
      result.push(t);
      continue;
    }

    const tmdbKey = String(rawTmdbId);
    if (!movieTmdbMap.has(tmdbKey)) {
      movieTmdbMap.set(tmdbKey, result.length);
      result.push(t);
    } else {
      const existing = result[movieTmdbMap.get(tmdbKey)];
      const existingKeys = new Set(existing.archivos.map(f => f.key));
      for (const f of t.archivos) {
        if (!existingKeys.has(f.key)) {
          existing.archivos.push(f);
          existingKeys.add(f.key);
        }
      }
      existing.ultimoMensajeFecha = Math.max(existing.ultimoMensajeFecha || 0, t.ultimoMensajeFecha || 0);
      if (!existing.metadata && t.metadata) existing.metadata = t.metadata;
      else if (existing.metadata && t.metadata?.collection && !existing.metadata.collection) {
        existing.metadata.collection = t.metadata.collection;
      }
      if (!existing.tmdbId && tmdbKey) existing.tmdbId = tmdbKey;
      sortFiles(existing.archivos, 'pelicula');
    }
  }

  return result;
}

/** cache: { [channelId]: { top, title, files } } */

/**
 * Detecta películas que pertenecen a una saga/colección (vía metadata TMDB)
 * y, si hay al menos 2 películas de la misma saga en la biblioteca,
 * genera/actualiza la ficha agrupada de Colección con grupo "Sagas",
 * asegurando que aparezca en "Películas · Sagas" y en la pestaña "Colecciones",
 * mientras las películas individuales continúan existiendo de forma suelta en "Películas" y "Novedades".
 */
export function attachAutoCollections(titles) {
  if (!Array.isArray(titles)) return [];

  // Excluir colecciones virtuales previas para recalcularlas limpiamente
  const baseTitles = titles.filter(t => !t.isVirtualSaga);
  const standaloneMovies = baseTitles.filter(t => t.tipo === 'pelicula' && !t.isSaga);

  // Mapear colecciones de TMDB por su ID
  const colMap = new Map(); // colId -> { collection, movies: [] }
  for (const m of standaloneMovies) {
    const col = m.metadata?.collection || (m.metadata?.belongs_to_collection ? {
      id: m.metadata.belongs_to_collection.id,
      name: m.metadata.belongs_to_collection.name,
      poster: m.metadata.belongs_to_collection.poster || null,
      backdrop: m.metadata.belongs_to_collection.backdrop || null,
    } : null);

    if (col && col.id) {
      const key = String(col.id);
      if (!colMap.has(key)) {
        colMap.set(key, { collection: col, movies: [] });
      }
      colMap.get(key).movies.push(m);
    }
  }

  const result = [...baseTitles];

  for (const [colId, { collection, movies }] of colMap.entries()) {
    // Si pertenecen a una saga y hay otra de su saga (mínimo 2 películas distintas)
    const distinctMovies = new Map();
    for (const m of movies) {
      const mId = String(m.metadata?.id || m.tmdbId || m.nombre);
      if (!distinctMovies.has(mId)) distinctMovies.set(mId, m);
    }
    if (distinctMovies.size < 2) continue;

    // Comprobar si ya existe una saga física (por canal) que cubra esta colección
    const existingSaga = baseTitles.find(t => t.isSaga && !t.isVirtualSaga && (
      String(t.tmdbId) === String(colId) ||
      String(t.metadata?.id) === String(colId) ||
      (t.nombre && collection.name && normalizeMovieKey(t.nombre) === normalizeMovieKey(collection.name))
    ));

    if (!existingSaga) {
      const allFiles = [];
      const seenFiles = new Set();
      for (const m of movies) {
        for (const f of (m.archivos || [])) {
          if (!seenFiles.has(f.key)) {
            seenFiles.add(f.key);
            allFiles.push({
              ...f,
              sagaName: m.metadata?.name || m.nombre || f.label,
              metadata: m.metadata || f.metadata,
              tmdbId: m.metadata?.id || f.tmdbId || m.tmdbId || null,
            });
          }
        }
      }

      const sagaTitle = {
        id: `collection_${colId}`,
        tipo: 'pelicula',
        isSaga: true,
        isVirtualSaga: true,
        grupo: 'Sagas',
        nombre: collection.name || `Colección ${movies[0].nombre}`,
        channel: movies[0].channel,
        origen: { tipo: 'auto_collection', collectionId: colId },
        archivos: allFiles,
        ultimoMensajeFecha: Math.max(...movies.map(m => m.ultimoMensajeFecha || 0)),
        tmdbId: String(colId),
        metadata: {
          id: Number(colId),
          type: 'collection',
          name: collection.name,
          poster: collection.poster || null,
          backdrop: collection.backdrop || null,
        },
      };

      result.push(sagaTitle);
    }
  }

  return result;
}

export async function buildTitles(client, channels, peerOf, onProgress, cache = {}) {
  const titles = [];
  const newCache = {};
  let done = 0;
  await Promise.all(channels.map(async (rawChannel) => {
    // Recupera las banderas derivadas también de la caché local creada antes de esta mejora.
    const ch = { ...rawChannel };
    const parsed = parseChannelTitle(ch.title);
    if (parsed) Object.assign(ch, { name: parsed.name, group: parsed.group, category: parsed.category, macro: !!parsed.macro, isYearContainer: !!parsed.isYearContainer, isSaga: !!parsed.isSaga });
    const prev = cache[ch.id];
    let files = [];
    if (prev && (!client || (prev.top === ch.top && prev.title === ch.title && ch.top))) {
      files = prev.files.map(f => ({ ...f, channel: f.channel || ch }));
    } else {
      try { files = await scanFiles(client, peerOf(ch), ch); }
      catch (e) { console.warn('[titles] no se pudo leer', ch.title, e); }
    }
    newCache[ch.id] = { top: ch.top, title: ch.title, files: files.map(f => ({ ...f })) };

    // Filtro: NO mostrar canales vacíos en TGVideo
    if (!files || files.length === 0) {
      onProgress?.(++done, channels.length);
      return;
    }

    if (ch.isYearContainer) {
      // Un canal por año es un contenedor: agrupa múltiples versiones de la misma película en una sola ficha.
      // Solo tomamos channelYear si el nombre del canal es un año único de 4 dígitos (ej: 1988), NO si es un rango (ej: 1990-1999).
      const channelYear = /^\d{4}$/.test(String(ch.name || '').trim()) ? ch.name.trim() : null;
      const movieMap = new Map();
      for (const f of files) {
        const targetFileName = f.captionFileName || f.fileName || f.label;
        const parsedFile = extractTitleAndYear(targetFileName);
        const yearHint = parsedFile.year || channelYear;
        const baseName = parsedFile.title || movieName(f);
        const normKey = f.tmdbId ? `tmdb_${f.tmdbId}` : `${normalizeMovieKey(baseName)}_${yearHint || ''}`;
        if (!movieMap.has(normKey)) {
          movieMap.set(normKey, {
            id: `${ch.id}:${f.messageId}`,
            nombre: baseName,
            yearHint,
            files: [f],
            tmdbId: f.tmdbId || null,
          });
        } else {
          const grp = movieMap.get(normKey);
          grp.files.push(f);
          if (!grp.tmdbId && f.tmdbId) grp.tmdbId = f.tmdbId;
          if (baseName.length < grp.nombre.length && baseName.length > 2) {
            grp.nombre = baseName;
          }
        }
      }
      const containerGroup = (YEAR_GROUP_RE.test(ch.group) ? ch.name : (ch.group || ch.name)) || 'Películas';
      for (const grp of movieMap.values()) {
        sortFiles(grp.files, 'pelicula');
        titles.push({
          id: String(grp.id), tipo: 'pelicula', isSaga: false,
          grupo: containerGroup,
          nombre: grp.nombre, yearHint: grp.yearHint,
          origen: { tipo: 'año_container', channelId: String(ch.id), messageId: grp.files[0].messageId },
          channel: ch, archivos: grp.files,
          ultimoMensajeFecha: grp.files.reduce((m, f) => Math.max(m, f.date), 0),
          tmdbId: grp.tmdbId,
        });
      }
    } else if (ch.isSaga) {
      // La saga permanece agrupada como una tarjeta única en 'Sagas'
      const sagaFiles = files.map(f => ({ ...f, sagaName: movieName(f) }));
      titles.push({
        id: String(ch.id), tipo: 'pelicula', isSaga: true, grupo: 'Sagas',
        nombre: ch.name, origen: { tipo: 'saga', channelId: String(ch.id) }, channel: ch,
        archivos: sagaFiles, ultimoMensajeFecha: files.reduce((m, f) => Math.max(m, f.date), 0),
        tmdbId: files.find(f => f.tmdbId)?.tmdbId || null,
      });

      // Y además, cada película de la saga aparece suelta en Películas y Novedades
      const movieMap = new Map();
      for (const f of files) {
        const targetFileName = f.captionFileName || f.fileName || f.label;
        const parsedFile = extractTitleAndYear(targetFileName);
        const yearHint = parsedFile.year || null;
        const baseName = parsedFile.title || movieName(f);
        const normKey = f.tmdbId ? `tmdb_${f.tmdbId}` : `${normalizeMovieKey(baseName)}_${yearHint || ''}`;
        if (!movieMap.has(normKey)) {
          movieMap.set(normKey, {
            id: `${ch.id}:${f.messageId}`,
            nombre: baseName,
            yearHint,
            files: [f],
            tmdbId: f.tmdbId || null,
          });
        } else {
          const grp = movieMap.get(normKey);
          grp.files.push(f);
          if (!grp.tmdbId && f.tmdbId) grp.tmdbId = f.tmdbId;
          if (baseName.length < grp.nombre.length && baseName.length > 2) {
            grp.nombre = baseName;
          }
        }
      }
      for (const grp of movieMap.values()) {
        sortFiles(grp.files, 'pelicula');
        titles.push({
          id: String(grp.id), tipo: 'pelicula', isSaga: false,
          grupo: ch.name || 'Películas',
          nombre: grp.nombre, yearHint: grp.yearHint,
          origen: { tipo: 'saga_pelicula', channelId: String(ch.id), messageId: grp.files[0].messageId },
          channel: ch, archivos: grp.files,
          ultimoMensajeFecha: grp.files.reduce((m, f) => Math.max(m, f.date), 0),
          tmdbId: grp.tmdbId,
          sagaChannelId: String(ch.id),
        });
      }
    } else if (ch.macro) {
      const isSeries = ch.category === 'Series';
      const keyed = files.map(f => (f.section || !isSeries) ? f : { ...f, section: seriesNameFromFile(f.captionFileName || f.fileName) });
      for (const [sec, fs] of splitBySection(keyed)) {
        if (fs && fs.length > 0) {
          const parsedSec = extractTitleAndYear(sec);
          const fileYear = fs.map(f => extractTitleAndYear(f.captionFileName || f.fileName || f.label).year).find(Boolean) || null;
          const titleYearHint = parsedSec.year || fileYear;
          const t = makeTitle({ id: `${ch.id}#${sec}`, ch, name: sec, origen: 'macro', seccion: sec, files: fs });
          if (titleYearHint) t.yearHint = titleYearHint;
          titles.push(t);
        }
      }
    } else {
      titles.push(makeTitle({ id: ch.id, ch, name: ch.name, origen: 'dedicado', files }));
    }
    onProgress?.(++done, channels.length);
  }));

  // Consolidar películas con el mismo ID de TMDB detectado previamente
  const finalTitles = attachAutoCollections(mergeMoviesByTmdb(titles.filter(t => t.archivos && t.archivos.length > 0)));
  return { titles: finalTitles, cache: newCache };
}
