export function isExternalTitle(t) {
  return Boolean(
    t?.origen?.tipo === "externo" ||
    t?.channel?.isExternal ||
    t?.isExternal ||
    (typeof t?.channel?.id === "string" && t.channel.id.includes("_top_"))
  );
}

// src/library/titles.js
/**
 * Capa de datos: convierte canales (dedicados, contenedores de año y macro) en "Títulos" unificados.
 * No toca el DOM.
 */
import { isVideoMessage, getFileName, parseCaption, parseEpisode, prettyName, prettyEpisodeName } from './parse.js';
import { splitBySection } from './macro.js';
import { parseChannelTitle } from './channels.js';
import { extractTitleAndYear, extractTitlesFromCaption } from '../metadata/tmdb.js';

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
    const ep = parseEpisode(fileName) || parseEpisode(rawCaption);
    const doc = msg.document || msg.media?.document;
    const durAttr = doc?.attributes?.find(a => a.className === 'DocumentAttributeVideo');
    files.push({
      key: `${ch.id}:${msg.id}`, channelId: String(ch.id), messageId: msg.id,
      channel: ch,
      fileName,
      captionFileName,
      rawFileName,
      rawCaption,
      caption: rawCaption,
      label: prettyName(fileName), section: cap.section || null,
      synopsis: cap.synopsis || null, tmdbId: cap.tmdbId ? String(cap.tmdbId).trim() : null, imdbId: cap.imdbId ? String(cap.imdbId).trim() : null, rating: cap.rating ? Number(cap.rating) : null,
      season: ep?.season, episode: ep?.episode,
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
    imdbId: files.find(f => f.imdbId)?.imdbId || null,
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
 * Desagrupa títulos que tengan múltiples archivos en tarjetas sueltas (1 por archivo o episodio).
 */
export function unbundleTitles(items = []) {
  if (!Array.isArray(items)) return [];
  const result = [];
  for (const t of items) {
    const files = t.archivos || [];
    if (files.length <= 1) {
      result.push(t);
      continue;
    }
    for (const f of files) {
      const rawEpName = f.captionFileName || f.fileName || '';
      const epLabel = t.tipo === 'serie'
        ? (f.label || prettyEpisodeName(rawEpName, t.nombre) || f.fileName || 'Episodio')
        : (f.label || f.fileName || t.nombre);
      result.push({
        ...t,
        id: `${t.channel?.id || t.id}:${f.messageId}`,
        nombre: epLabel,
        archivos: [f],
        metadata: f.metadata || t.metadata,
        ultimoMensajeFecha: f.date || t.ultimoMensajeFecha || 0,
        parentTitle: t,
        isLooseFile: true,
      });
    }
  }
  return result;
}

/**
 * Agrupa una lista de títulos/archivos sueltos por serie (para episodios) y por película/TMDB.
 */
export function groupTitles(items = []) {
  if (!Array.isArray(items)) return [];
  const seriesMap = new Map();
  const movieMap = new Map();
  const others = [];

  for (const it of items) {
    const isSeries = it.tipo === 'serie';
    const isMovie = it.tipo === 'pelicula' || it.tipo === 'documental';
    const files = it.archivos && it.archivos.length > 0 ? it.archivos : [{
      messageId: it.messageId || String(it.id).split(':')[1] || 0,
      fileName: it.fileName || it.nombre,
      date: it.ultimoMensajeFecha || 0,
      channel: it.channel,
      metadata: it.metadata,
    }];

    if (isSeries) {
      const firstFile = files[0];
      const rawName = firstFile?.captionFileName || firstFile?.fileName || it.nombre;
      const sName = String(it.parentTitle?.nombre || (it.isLooseFile ? seriesNameFromFile(rawName) : null) || it.nombre || 'Serie').trim();
      const key = `${it.channel?.id || ''}:${sName.toLowerCase()}`;
      if (!seriesMap.has(key)) {
        seriesMap.set(key, {
          ...it,
          id: it.parentTitle?.id || it.id,
          nombre: sName,
          archivos: [...files],
        });
      } else {
        const grp = seriesMap.get(key);
        for (const f of files) {
          if (!grp.archivos.some(existing => existing.messageId === f.messageId)) {
            grp.archivos.push(f);
          }
        }
      }
    } else if (isMovie) {
      const firstFile = files[0];
      const rawTmdb = it.tmdbId || it.metadata?.id || firstFile?.tmdbId || firstFile?.metadata?.id;
      const baseName = it.parentTitle?.nombre || it.nombre;
      const key = rawTmdb ? `tmdb_${rawTmdb}` : `${it.channel?.id || ''}:${normalizeMovieKey(baseName)}`;
      if (!movieMap.has(key)) {
        movieMap.set(key, {
          ...it,
          id: it.parentTitle?.id || it.id,
          nombre: baseName,
          archivos: [...files],
        });
      } else {
        const grp = movieMap.get(key);
        for (const f of files) {
          if (!grp.archivos.some(existing => existing.messageId === f.messageId)) {
            grp.archivos.push(f);
          }
        }
      }
    } else {
      others.push(it);
    }
  }

  // Ordenar episodios dentro de cada serie
  for (const s of seriesMap.values()) {
    s.archivos.sort((a, b) => (a.season - b.season) || (a.episode - b.episode) || (a.date - b.date));
  }
  // Ordenar archivos de versiones de película por tamaño
  for (const m of movieMap.values()) {
    m.archivos.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0));
  }

  return [...seriesMap.values(), ...movieMap.values(), ...others];
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

    // Los títulos de canales externos se preservan de forma independiente para que
    // el usuario siempre pueda encontrarlos y revisarlos en la cuadrícula de su canal ("+")
    // aunque la misma película exista en otros canales.
    if (isExternalTitle(t)) {
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
  // Quitar los archivos que una pasada anterior añadió a sagas físicas (se recalculan abajo)
  for (const t of baseTitles) {
    if (t.isSaga && Array.isArray(t.archivos) && t.archivos.some(f => f._extraCollection)) {
      t.archivos = t.archivos.filter(f => !f._extraCollection);
    }
  }
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
          rating: (() => {
            const v = movies.map(m => Number(m.metadata?.imdbRating ?? m.metadata?.rating)).filter(r => r > 0);
            return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : 0;
          })(),
          imdbRating: (() => {
            const v = movies.map(m => Number(m.metadata?.imdbRating ?? m.metadata?.rating)).filter(r => r > 0);
            return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : 0;
          })(),
        },
      };

      result.push(sagaTitle);
    } else {
      // Saga física (canal) ya existente: incluir también las películas añadidas manualmente a la
      // colección ("Añadir a colección") o detectadas por TMDB que viven fuera del canal de la saga.
      if (existingSaga.metadata && !existingSaga.metadata.rating) {
        const v = (existingSaga.archivos || []).concat(movies).map(m => Number(m.metadata?.imdbRating ?? m.metadata?.rating)).filter(r => r > 0);
        if (v.length) {
          const avg = +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1);
          existingSaga.metadata.rating = avg;
          existingSaga.metadata.imdbRating = avg;
        }
      }
      existingSaga.archivos = existingSaga.archivos || [];
      const have = new Set(existingSaga.archivos.map(f => f.key));
      for (const m of movies) {
        for (const f of (m.archivos || [])) {
          if (have.has(f.key)) continue;
          have.add(f.key);
          existingSaga.archivos.push({
            ...f,
            _extraCollection: true,
            sagaName: m.metadata?.name || m.nombre || f.label,
            metadata: m.metadata || f.metadata,
            tmdbId: m.metadata?.id || f.tmdbId || m.tmdbId || null,
          });
        }
      }
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
        const capCand = extractTitlesFromCaption(f.rawCaption || f.caption || '')[0];
        const isGenericName = !parsedFile.title || /^video_\d+/i.test(parsedFile.title) || /^[0-9\-_.]+(?:accion|pelicula|movie|fhd|hd|rip)?/i.test(parsedFile.title) || parsedFile.title.length < 3;
        const baseName = (isGenericName && capCand?.title) ? capCand.title : (parsedFile.title || capCand?.title || movieName(f));
        const yearHint = parsedFile.year || capCand?.year || channelYear;
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
        imdbId: files.find(f => f.imdbId)?.imdbId || null,
      });

      // Y además, cada película de la saga aparece suelta en Películas y Novedades
      const movieMap = new Map();
      for (const f of files) {
        const targetFileName = f.captionFileName || f.fileName || f.label;
        const parsedFile = extractTitleAndYear(targetFileName);
        const capCand = extractTitlesFromCaption(f.rawCaption || f.caption || '')[0];
        const isGenericName = !parsedFile.title || /^video_\d+/i.test(parsedFile.title) || /^[0-9\-_.]+(?:accion|pelicula|movie|fhd|hd|rip)?/i.test(parsedFile.title) || parsedFile.title.length < 3;
        const baseName = (isGenericName && capCand?.title) ? capCand.title : (parsedFile.title || capCand?.title || movieName(f));
        const yearHint = parsedFile.year || capCand?.year || null;
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
      const keyed = files.map(f => {
        if (f.section) return f;
        if (isSeries) return { ...f, section: seriesNameFromFile(f.captionFileName || f.fileName) };
        const capCand = extractTitlesFromCaption(f.rawCaption || f.caption || '')[0];
        const parsedFile = extractTitleAndYear(f.captionFileName || f.fileName || f.label);
        return { ...f, section: capCand?.title || parsedFile.title || movieName(f), yearHint: capCand?.year || parsedFile.year };
      });
      for (const [sec, fs] of splitBySection(keyed)) {
        if (fs && fs.length > 0) {
          const parsedSec = extractTitleAndYear(sec);
          const fileYear = fs.map(f => f.yearHint || extractTitleAndYear(f.captionFileName || f.fileName || f.label).year).find(Boolean) || null;
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
